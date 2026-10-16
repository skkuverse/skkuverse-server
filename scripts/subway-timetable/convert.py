#!/usr/bin/env python3
"""Build the committed subway timetables in src/subway/timetable/ (OpenSpec add-subway-arrivals, design D6).

When to rerun:

    - Korail publishes a new 1호선 timetable (a 사업계획변경 신고, usually with a new semester or a
      timetable change notice on korail.com). Update KORAIL_WEEKDAY_URL, KORAIL_HOLIDAY_URL and
      KORAIL_REVISION below to the new files, then rerun.
    - Seoul Metro changes the 4호선 timetable (a 열차운행시각 조정 notice). Rerun; the Seoul API
      already serves the new table.
    - A served station or one of its upstream stations changes (LINE1_STATIONS, LINE4_STATIONS).

How to rerun (from the repository root):

    doppler run -p backend -c dev_personal -- python3 -I scripts/subway-timetable/convert.py

The 4호선 part reads SEOUL_OPENAPI_GENERAL_KEY from the environment, and no other variable; Doppler
backend/dev_personal holds it, a config no service renders. `--only korail` needs no key. `--korail-weekday FILE` and `--korail-holiday FILE` read local
copies of the two Korail URLs instead of downloading them. Review the diff, then commit the JSON.

What it writes, per operator line and day type:

    korail-1-weekday.json, korail-1-holiday.json                      1호선, Korail xlsx
    seoul-4-weekday.json, seoul-4-saturday.json, seoul-4-holiday.json   4호선, SearchSTNTimeTableByIDService

Each file lists the trains that stop at the served station (성균관대 KR-1-0153, 혜화 S1-4-420) with
their stops among the covered stations (the served station and three on each side), in travel order.
Times are seconds after 00:00 of the service day. A clock time before SERVICE_DAY_START (03:00)
belongs to the previous service day and gets 86400 added, so 00:13:30 is 87210; Seoul already writes
those as 24:13:30. Either way the times must then increase along the train, or the run fails.

Rules taken from the data (checked on the 2026-08-28 Korail files and the 2026-10-16 Seoul tables):

    - Train numbers keep their digits, zero-padded to four: K602 -> 0602, S418 -> 0418,
      K4302 -> 4302, K1902 -> 1902.
    - Korail: a station is a stop when its arrival row has a time. The origin has only a departure,
      the terminus only an arrival. A departure-row time without an arrival mid-route is a pass:
      only express trains have one.
    - Korail express: train numbers 1000-1999 (the K19xx 급행; the 서울급행 sheet holds only those).
      A train with a pass outside that range fails the run.
    - Seoul express: EXPRESS_YN "G" is 일반, "D" is 급행; any other value fails the run. Every
      2026-10-16 row was "G". ARRIVETIME or LEFTTIME "00:00:00" means none (the origin or terminus).
    - Seoul joins one train across the seven station codes by its normalized number, within one
      WEEK_TAG and INOUT_TAG. A number that appears twice at one station is split into runs by time
      continuity: each row joins the run of the same number that left an earlier station at most
      MAX_HOP_SECONDS before it. No number repeated on 2026-10-16.

Only the standard library is used (zipfile and xml.etree read the xlsx). The API key is never printed:
failures name only the station code, the tags and the HTTP status or API result code.
"""

import argparse
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

KORAIL_REVISION = "2026-08-28"
KORAIL_WEEKDAY_URL = "https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c6bb40560.xlsx"
KORAIL_HOLIDAY_URL = "https://www.korail.com/file/cubedata/COMMON/jfile/202608/28/202608281a045c713b2610.xlsx"
KORAIL_SHEET_PREFIXES = ("경부", "서동탄", "서울급행")

SEOUL_API = "SearchSTNTimeTableByIDService"
SEOUL_URL = "http://openapi.seoul.go.kr:8088/{key}/json/" + SEOUL_API + "/{start}/{end}/{code}/{week}/{inout}/"
SEOUL_PAGE = 1000
SEOUL_WEEK_TAGS = (("weekday", "1"), ("saturday", "2"), ("holiday", "3"))
SEOUL_INOUT = (("up", "1"), ("down", "2"))
SEOUL_EXPRESS = {"G": False, "D": True}

SERVICE_DAY_START = 3 * 3600
DAY = 86400
MAX_HOP_SECONDS = 600

# KRIC code (운영기관_역사_코드정보, 2022-08-26) and the Korail xlsx short name, south to north.
LINE1_STATIONS = (
    ("KR-1-P157", "병점"),
    ("KR-1-1715", "세류"),
    ("KR-1-P155", "수원"),
    ("KR-1-P154", "화서"),
    ("KR-1-0153", "성균관"),
    ("KR-1-P152", "의왕"),
    ("KR-1-P151", "당정"),
    ("KR-1-P150", "군포"),
)
LINE1_SERVED = "KR-1-0153"

# KRIC code and the Seoul STATION_CD, north to south.
LINE4_STATIONS = (
    ("S1-4-417", "0417"),
    ("S1-4-418", "0418"),
    ("S1-4-419", "0419"),
    ("S1-4-420", "0420"),
    ("S1-4-421", "0421"),
    ("S1-4-422", "0422"),
    ("S1-4-423", "0423"),
)
LINE4_SERVED = "S1-4-420"

KORAIL_NAMES = {name: code for code, name in LINE1_STATIONS}
LINE1_ORDER = [code for code, _ in LINE1_STATIONS]

XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


class ConvertError(Exception):
    pass


# ---------------------------------------------------------------- shared rules

def normalize_train_no(raw):
    """K602 -> 0602, S418 -> 0418, K4302 -> 4302, 1906 -> 1906."""
    match = re.fullmatch(r"\s*[A-Z]*(\d{1,4})\s*", raw or "")
    if match is None:
        raise ConvertError("train number %r is not letters followed by at most four digits" % (raw,))
    return match.group(1).zfill(4)


def service_seconds(clock_seconds):
    """Seconds after 00:00 of the service day: a clock time before 03:00 belongs to the previous day."""
    return clock_seconds + DAY if clock_seconds < SERVICE_DAY_START else clock_seconds


def excel_seconds(fraction, where):
    """An Excel day fraction (0.2534722 for 06:05:00) as clock seconds, which must be whole."""
    exact = fraction * DAY
    seconds = int(round(exact))
    if abs(exact - seconds) > 0.5 or not 0 <= seconds < 2 * DAY:
        raise ConvertError("%s: %r is not a time of day" % (where, fraction))
    return seconds % DAY


def hms_seconds(value, where):
    """HH:MM:SS as clock seconds; None for 00:00:00, which the Seoul API sends for none. HH may pass 24."""
    match = re.fullmatch(r"(\d{2}):([0-5]\d):([0-5]\d)", value or "")
    if match is None:
        raise ConvertError("%s: %r is not HH:MM:SS" % (where, value))
    seconds = int(match.group(1)) * 3600 + int(match.group(2)) * 60 + int(match.group(3))
    return None if seconds == 0 else seconds


def stop_time(stop):
    return stop["arr"] if stop["arr"] is not None else stop["dep"]


def validate_train(train, served, label):
    """The train stops at the served station, and its times increase along its stops."""
    if not any(stop["station"] == served for stop in train["stops"]):
        raise ConvertError("%s: train %s (%s) has no stop at %s" % (label, train["trainNo"], train["direction"], served))
    previous = None
    for index, stop in enumerate(train["stops"]):
        if stop["arr"] is None and stop["dep"] is None:
            raise ConvertError("%s: train %s has no time at %s" % (label, train["trainNo"], stop["station"]))
        if stop["arr"] is not None and stop["dep"] is not None and stop["dep"] < stop["arr"]:
            raise ConvertError("%s: train %s leaves %s before it arrives" % (label, train["trainNo"], stop["station"]))
        if index > 0 and stop["arr"] is None:
            raise ConvertError("%s: train %s has no arrival at %s" % (label, train["trainNo"], stop["station"]))
        first = stop_time(stop)
        if previous is not None and first <= previous:
            raise ConvertError("%s: train %s goes back in time at %s" % (label, train["trainNo"], stop["station"]))
        previous = stop["dep"] if stop["dep"] is not None else stop["arr"]


def sort_trains(trains):
    return sorted(trains, key=lambda t: (t["trainNo"], t["direction"], stop_time(t["stops"][0])))


def check_unique(trains, label, allow_split):
    seen = {}
    for train in trains:
        key = (train["trainNo"], train["direction"])
        if key in seen and not (allow_split and train.get("_split")):
            raise ConvertError("%s: train %s (%s) appears twice" % (label, key[0], key[1]))
        seen[key] = True


# ---------------------------------------------------------------- xlsx

def column_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    index = 0
    for char in letters:
        index = index * 26 + ord(char) - 64
    return index - 1


def read_workbook(data):
    """{sheet name: {row number: {column index: str | float}}} from xlsx bytes, cached values only."""
    import io

    archive = zipfile.ZipFile(io.BytesIO(data))
    names = set(archive.namelist())
    shared = []
    if "xl/sharedStrings.xml" in names:
        for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("{%s}si" % XLSX_NS):
            parts = [t.text or "" for t in item.findall("{%s}t" % XLSX_NS)]
            parts += [t.text or "" for run in item.findall("{%s}r" % XLSX_NS) for t in run.findall("{%s}t" % XLSX_NS)]
            shared.append("".join(parts))
    rels = {rel.get("Id"): rel.get("Target") for rel in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels")).findall("{%s}Relationship" % PKG_REL_NS)}
    sheets = {}
    for sheet in ET.fromstring(archive.read("xl/workbook.xml")).find("{%s}sheets" % XLSX_NS):
        target = rels[sheet.get("{%s}id" % REL_NS)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = {}
        for row in ET.fromstring(archive.read(target)).iter("{%s}row" % XLSX_NS):
            cells = {}
            for cell in row.findall("{%s}c" % XLSX_NS):
                kind = cell.get("t")
                value = cell.find("{%s}v" % XLSX_NS)
                if kind == "inlineStr":
                    cells[column_index(cell.get("r"))] = "".join(t.text or "" for t in cell.iter("{%s}t" % XLSX_NS))
                elif value is None:
                    continue
                elif kind == "s":
                    cells[column_index(cell.get("r"))] = shared[int(value.text)]
                elif kind in ("str", "e", "b"):
                    cells[column_index(cell.get("r"))] = value.text or ""
                else:
                    cells[column_index(cell.get("r"))] = float(value.text)
            rows[int(row.get("r"))] = cells
        sheets[sheet.get("name")] = rows
    return sheets


# ---------------------------------------------------------------- Korail (1호선)

def korail_code(name, where):
    """The KRIC code of a covered short name, None for an uncovered station; refuses a near miss."""
    if name in KORAIL_NAMES:
        return KORAIL_NAMES[name]
    for covered in KORAIL_NAMES:
        if name[:2] == covered[:2]:
            raise ConvertError("%s: station name %r looks like %r but is not in the name table" % (where, name, covered))
    return None


def is_blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def korail_cell(rows, row, column, where):
    value = rows.get(row, {}).get(column)
    if is_blank(value):
        return None
    if isinstance(value, float):
        return excel_seconds(value, where)
    raise ConvertError("%s: unexpected value %r" % (where, value))


def korail_blocks(rows, sheet):
    """(name column, train columns) per block: a block starts where row 4 reads 열차번호."""
    header = rows.get(4, {})
    starts = sorted(c for c, v in header.items() if isinstance(v, str) and v.strip() == "열차번호")
    if not starts:
        raise ConvertError("%s: no 열차번호 in row 4" % sheet)
    blocks = []
    for index, start in enumerate(starts):
        for row, label in ((2, "시발역"), (3, "종착역")):
            value = rows.get(row, {}).get(start)
            if not (isinstance(value, str) and value.strip() == label):
                raise ConvertError("%s: row %d column %d is not %s" % (sheet, row, start + 1, label))
        end = starts[index + 1] if index + 1 < len(starts) else max(header) + 1
        columns = [c for c in range(start + 1, end) if not is_blank(header.get(c))]
        blocks.append((start, columns))
    return blocks


def korail_direction(station_rows, sheet):
    """up when the block lists the covered stations south to north, down when north to south."""
    codes = [code for _, _, code in station_rows if code is not None]
    if LINE1_SERVED not in codes:
        raise ConvertError("%s: no 성균관 row" % sheet)
    if len(set(codes)) != len(codes):
        raise ConvertError("%s: a covered station is listed twice" % sheet)
    positions = [LINE1_ORDER.index(code) for code in codes]
    if len(positions) < 2:
        raise ConvertError("%s: too few covered stations to tell the direction" % sheet)
    if positions == sorted(positions):
        direction = "up"
    elif positions == sorted(positions, reverse=True):
        direction = "down"
    else:
        raise ConvertError("%s: covered stations are out of line order" % sheet)
    suffix = {"상": "up", "하": "down"}.get(sheet.rsplit("_", 1)[-1])
    if suffix is not None and suffix != direction:
        raise ConvertError("%s: the sheet name says %s but the stations run %s" % (sheet, suffix, direction))
    return direction


def korail_train(rows, sheet, column, station_rows, direction):
    """One train column as a train with its stops at covered stations, or None if it skips 성균관."""
    where = "%s column %d" % (sheet, column + 1)
    raw_no = rows[4][column]
    try:
        train_no = normalize_train_no(raw_no)
    except ConvertError as error:
        raise ConvertError("%s: %s" % (where, error))
    timed = []
    for row, _, code in station_rows:
        arr = korail_cell(rows, row, column, "%s row %d" % (where, row))
        dep = korail_cell(rows, row + 1, column, "%s row %d" % (where, row + 1))
        if arr is not None or dep is not None:
            timed.append((row, code, arr, dep))
    if not timed:
        return None
    stops = []
    has_pass = False
    for index, (row, code, arr, dep) in enumerate(timed):
        is_origin = index == 0
        is_terminus = index == len(timed) - 1
        if is_origin:
            if dep is None:
                raise ConvertError("%s row %d: the origin has no departure" % (where, row))
            arr = None
        elif is_terminus:
            if arr is None:
                raise ConvertError("%s row %d: the terminus has no arrival" % (where, row))
            dep = None
        elif arr is None:
            has_pass = True
            continue
        elif dep is None:
            raise ConvertError("%s row %d: an arrival without a departure mid-route" % (where, row))
        if code is not None:
            stops.append({"station": code, "arr": None if arr is None else service_seconds(arr), "dep": None if dep is None else service_seconds(dep)})
    express = train_no.startswith("1")
    if has_pass and not express:
        raise ConvertError("%s: train %s passes a station but is not numbered 1xxx" % (where, raw_no.strip()))
    if not any(stop["station"] == LINE1_SERVED for stop in stops):
        return None
    destination = rows.get(3, {}).get(column)
    if is_blank(destination):
        raise ConvertError("%s: no 종착역" % where)
    return {"trainNo": train_no, "direction": direction, "destination": destination.strip(), "express": express, "stops": stops}


def korail_trains(sheets):
    """Every train of the selected sheets that stops at 성균관."""
    trains = []
    for sheet, rows in sheets.items():
        if not sheet.startswith(KORAIL_SHEET_PREFIXES):
            continue
        for name_column, columns in korail_blocks(rows, sheet):
            station_rows = []
            for row in sorted(r for r in rows if r > 4):
                name = rows[row].get(name_column)
                if is_blank(name):
                    continue
                if not isinstance(name, str):
                    raise ConvertError("%s row %d: station name %r is not text" % (sheet, row, name))
                if not is_blank(rows.get(row + 1, {}).get(name_column)):
                    raise ConvertError("%s row %d: the departure row below a station holds a name" % (sheet, row + 1))
                station_rows.append((row, name.strip(), korail_code(name.strip(), "%s row %d" % (sheet, row))))
            direction = korail_direction(station_rows, sheet)
            for column in columns:
                train = korail_train(rows, sheet, column, station_rows, direction)
                if train is not None:
                    validate_train(train, LINE1_SERVED, sheet)
                    trains.append(train)
    return trains


# ---------------------------------------------------------------- Seoul (4호선)

def seoul_trips(rows_by_station, direction):
    """Join one direction's station rows into trains, by normalized number and time continuity.

    rows_by_station: [(KRIC code, [API row, ...])] in the order the API was asked, any order.
    """
    order = [code for code, _ in LINE4_STATIONS]
    if direction == "up":
        order = order[::-1]
    candidates = []
    for code, rows in rows_by_station:
        for row in rows:
            where = "%s %s %s" % (code, direction, row.get("TRAIN_NO"))
            arr = hms_seconds(row.get("ARRIVETIME"), where + " ARRIVETIME")
            dep = hms_seconds(row.get("LEFTTIME"), where + " LEFTTIME")
            if arr is None and dep is None:
                raise ConvertError("%s: neither an arrival nor a departure" % where)
            if row.get("EXPRESS_YN") not in SEOUL_EXPRESS:
                raise ConvertError("%s: EXPRESS_YN %r is neither G nor D" % (where, row.get("EXPRESS_YN")))
            candidates.append({
                "trainNo": normalize_train_no(row.get("TRAIN_NO")),
                "index": order.index(code),
                "station": code,
                "arr": None if arr is None else service_seconds(arr),
                "dep": None if dep is None else service_seconds(dep),
                "destination": (row.get("SUBWAYENAME") or "").strip(),
                "express": SEOUL_EXPRESS[row["EXPRESS_YN"]],
            })
    candidates.sort(key=lambda c: (c["trainNo"], stop_time(c), c["index"]))
    trips = []
    open_trips = {}
    for stop in candidates:
        best = None
        for trip in open_trips.get(stop["trainNo"], []):
            last = trip["stops"][-1]
            gap = stop_time(stop) - (last["dep"] if last["dep"] is not None else last["arr"])
            if last["index"] < stop["index"] and 0 < gap <= MAX_HOP_SECONDS and (best is None or gap < best[0]):
                best = (gap, trip)
        if best is None:
            trip = {"trainNo": stop["trainNo"], "stops": []}
            open_trips.setdefault(stop["trainNo"], []).append(trip)
            trips.append(trip)
        else:
            trip = best[1]
        trip["stops"].append(stop)
    trains = []
    for trip in trips:
        stops = trip["stops"]
        destinations = {s["destination"] for s in stops}
        if len(destinations) != 1 or "" in destinations:
            raise ConvertError("train %s (%s): destinations %s disagree or are empty" % (trip["trainNo"], direction, sorted(destinations)))
        expresses = {s["express"] for s in stops}
        if len(expresses) != 1:
            raise ConvertError("train %s (%s): EXPRESS_YN disagrees across stations" % (trip["trainNo"], direction))
        trains.append({
            "trainNo": trip["trainNo"],
            "direction": direction,
            "destination": destinations.pop(),
            "express": expresses.pop(),
            "stops": [{"station": s["station"], "arr": s["arr"], "dep": s["dep"]} for s in stops],
            "_split": len(open_trips[trip["trainNo"]]) > 1,
        })
    return trains


def seoul_fetch(key, code, week, inout):
    """Every row of one station, day type and direction, paged by SEOUL_PAGE."""
    rows = []
    start = 1
    label = "station %s WEEK_TAG %s INOUT_TAG %s" % (code, week, inout)
    while True:
        url = SEOUL_URL.format(key=key, start=start, end=start + SEOUL_PAGE - 1, code=code, week=week, inout=inout)
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise ConvertError("%s: HTTP %d" % (label, error.code)) from None
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise ConvertError("%s: request failed (%s)" % (label, type(error).__name__)) from None
        result = body.get(SEOUL_API)
        if result is None:
            code_ = (body.get("RESULT") or {}).get("CODE")
            raise ConvertError("%s: API result %s" % (label, code_))
        status = (result.get("RESULT") or {}).get("CODE")
        if status != "INFO-000":
            raise ConvertError("%s: API result %s" % (label, status))
        page = result.get("row") or []
        for row in page:
            if (row.get("STATION_CD"), row.get("WEEK_TAG"), row.get("INOUT_TAG")) != (code, week, inout):
                raise ConvertError("%s: a row for another station or tag" % label)
        rows += page
        total = int(result.get("list_total_count", 0))
        if len(rows) >= total or not page:
            break
        start += SEOUL_PAGE
    if len(rows) != total:
        raise ConvertError("%s: %d rows of %d" % (label, len(rows), total))
    return rows


def seoul_trains(fetch, week):
    trains = []
    for direction, inout in SEOUL_INOUT:
        rows_by_station = [(code, fetch(station_cd, week, inout)) for code, station_cd in LINE4_STATIONS]
        for train in seoul_trips(rows_by_station, direction):
            if any(stop["station"] == LINE4_SERVED for stop in train["stops"]):
                validate_train(train, LINE4_SERVED, "seoul WEEK_TAG %s" % week)
                trains.append(train)
    return trains


# ---------------------------------------------------------------- output

def timetable(kind, ref, revision, operator, line, day_type, stations, trains):
    return {
        "source": {"kind": kind, "ref": ref, "revision": revision},
        "operator": operator,
        "line": line,
        "dayType": day_type,
        "stations": stations,
        "trains": [{k: v for k, v in t.items() if not k.startswith("_")} for t in sort_trains(trains)],
    }


def render(document):
    return json.dumps(document, ensure_ascii=False, indent=2) + "\n"


def keep_revision(path, document):
    """A rerun over unchanged trains keeps the file's revision, so the output is byte-identical."""
    try:
        with open(path, encoding="utf-8") as handle:
            existing = json.load(handle)
    except (OSError, ValueError):
        return document
    if existing.get("trains") == document["trains"] and existing.get("source", {}).get("ref") == document["source"]["ref"]:
        document["source"]["revision"] = existing["source"]["revision"]
    return document


def write(out_dir, name, document):
    path = os.path.join(out_dir, name)
    if document["source"]["kind"] == "seoul-station-timetable":
        document = keep_revision(path, document)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(render(document))
    served = LINE1_SERVED if document["line"] == "1" else LINE4_SERVED
    by_direction = {d: sum(1 for t in document["trains"] if t["direction"] == d) for d in ("up", "down")}
    print("%s: %d trains at %s (up %d, down %d), revision %s" % (name, len(document["trains"]), served, by_direction["up"], by_direction["down"], document["source"]["revision"]))


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "skkuverse-server scripts/subway-timetable"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise ConvertError("%s: HTTP %d" % (url, error.code)) from None


def build_korail(out_dir, weekday_file, holiday_file):
    for day_type, url, local in (("weekday", KORAIL_WEEKDAY_URL, weekday_file), ("holiday", KORAIL_HOLIDAY_URL, holiday_file)):
        if local:
            with open(local, "rb") as handle:
                data = handle.read()
        else:
            data = download(url)
        trains = korail_trains(read_workbook(data))
        check_unique(trains, "korail %s" % day_type, allow_split=False)
        document = timetable("korail-xlsx", url, KORAIL_REVISION, "KR", "1", day_type, LINE1_ORDER, trains)
        write(out_dir, "korail-1-%s.json" % day_type, document)


def build_seoul(out_dir, today):
    key = os.environ.get("SEOUL_OPENAPI_GENERAL_KEY")
    if not key:
        raise ConvertError("SEOUL_OPENAPI_GENERAL_KEY is not set; run through doppler run -p backend -c dev_personal --")

    def fetch(code, week, inout):
        return seoul_fetch(key, code, week, inout)

    for day_type, week in SEOUL_WEEK_TAGS:
        trains = seoul_trains(fetch, week)
        check_unique(trains, "seoul %s" % day_type, allow_split=True)
        stations = [code for code, _ in LINE4_STATIONS]
        document = timetable("seoul-station-timetable", SEOUL_API, today, "S1", "4", day_type, stations, trains)
        write(out_dir, "seoul-4-%s.json" % day_type, document)


def main(argv=None):
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser = argparse.ArgumentParser(description="Build src/subway/timetable/*.json from the Korail xlsx files and the Seoul API.")
    parser.add_argument("--only", choices=("korail", "seoul"), help="build one source only")
    parser.add_argument("--out", default=os.path.join(root, "src", "subway", "timetable"), help="output directory")
    parser.add_argument("--korail-weekday", help="a local copy of KORAIL_WEEKDAY_URL")
    parser.add_argument("--korail-holiday", help="a local copy of KORAIL_HOLIDAY_URL")
    args = parser.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    try:
        if args.only in (None, "korail"):
            build_korail(args.out, args.korail_weekday, args.korail_holiday)
        if args.only in (None, "seoul"):
            build_seoul(args.out, today)
    except ConvertError as error:
        print("convert.py: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
