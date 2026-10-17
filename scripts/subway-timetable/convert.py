#!/usr/bin/env python3
"""Build the committed subway timetables in src/subway/timetable/ (OpenSpec add-subway-arrivals, design D6, and
add-commute-station-subway, design D8).

When to rerun:

    - Korail publishes a new 1호선 timetable (a 사업계획변경 신고, usually with a new semester or a
      timetable change notice on korail.com). Update KORAIL_WEEKDAY_URL, KORAIL_HOLIDAY_URL and
      KORAIL_REVISION below to the new files, then rerun.
    - Seoul Metro changes the 2/3/4/8호선 timetable (a 열차운행시각 조정 notice). Rerun; the Seoul API
      already serves the new table. `--line 2` (repeatable) rebuilds one line only.
    - A served station or one of its upstream or watched stations changes (the line's entry in LINES:
      its stations and served platforms).

How to rerun (from the repository root):

    doppler run -p backend -c dev_personal -- python3 -I scripts/subway-timetable/convert.py

The Seoul part reads SEOUL_OPENAPI_GENERAL_KEY from the environment, and no other variable; Doppler
backend/dev_personal holds it, a config no service renders. `--only korail` needs no key. `--korail-weekday FILE` and `--korail-holiday FILE` read local
copies of the two Korail URLs instead of downloading them. Review the diff, then commit the JSON.

What it writes, per operator line and day type:

    korail-1-weekday.json, korail-1-holiday.json                      1호선, Korail xlsx
    seoul-{2,3,4,8}-{weekday,saturday,holiday}.json                    2/3/4/8호선, SearchSTNTimeTableByIDService

Each file lists the trains that stop at one of its line's served platforms (LINES) with their stops among
the covered stations (each served platform and three stations on each side, and for 성균관대 also 금정
KR-1-P149, the first stop north of it every down 급행 of the 경부 sheets makes), in travel order.
Times are seconds after 00:00 of the service day. A clock time before SERVICE_DAY_START (03:00)
belongs to the previous service day and gets 86400 added, so 00:13:30 is 87210; Seoul already writes
those as 24:13:30. Either way the times must then increase along the train, or the run fails.

Rules taken from the data (checked on the 2026-08-28 Korail files and the 2026-10-16 Seoul tables):

    - Train numbers keep their digits, zero-padded to four: K602 -> 0602, S418 -> 0418,
      K4302 -> 4302, K1902 -> 1902, and the Seoul timetable's Korail-run 3호선 3024K -> 3024.
    - Korail: a station is a stop when its arrival row has a time. The origin has only a departure,
      the terminus only an arrival. A departure-row time without an arrival mid-route is a pass:
      only express trains have one.
    - Korail destinations: the 종착역 row writes the underground platforms of the Seoul Metro section
      short (1지청 for 청량리, 지하서 for 서울); each is written as the train map and the Seoul API
      write it (KORAIL_ABBREVIATIONS), any other name must be in KORAIL_TERMINI, and a name in neither
      fails the run. The tracker reads a train's direction off its destination.
    - Korail express: train numbers 1000-1999 (the K19xx 급행; the 서울급행 sheet holds only those).
      A train with a pass outside that range fails the run.
    - Seoul express: EXPRESS_YN "G" is 일반, "D" is 급행; any other value fails the run. Every
      2026-10-16 row was "G". ARRIVETIME or LEFTTIME "00:00:00" means none (the origin or terminus);
      the one mid-route hole of 2026-10-17 is filled from SEOUL_ARRIVAL_FIXES.
    - Seoul joins one train across the seven station codes by its normalized number, within one
      WEEK_TAG and INOUT_TAG. A number that appears twice at one station is split into runs by time
      continuity: each row joins the run of the same number that left an earlier station at most
      MAX_HOP_SECONDS before it. No number repeated on 2026-10-16.
    - 2호선: INOUT_TAG 1 is 내선순환 (up). The API and the timetable name nearly every circle trip 성수 in
      both directions, so a 성수 destination is written as 내선순환 or 외선순환 by direction, as the train
      map writes it; real termini (신도림, 삼성, ...) stay named. A 성수지선 or 신정지선 number (15xx-17xx,
      55xx-57xx) fails the run: no covered station sees a branch train.
    - No destination names trains of both directions (check_one_direction), except one the line declares
      with its evidence: the tracker reads a train's direction off its destination.

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

# Arrivals the Seoul API leaves out mid-route, keyed by (STATION_CD, WEEK_TAG, INOUT_TAG, TRAIN_NO, LEFTTIME). On
# 2026-10-17 it answered 3305 at 교대 (0330) on Saturdays with ARRIVETIME 00:00:00, though the train starts at 구파발
# (0310); its holiday row, identical to the Saturday table everywhere else, reads 21:08:00. A key that no longer
# matches is printed, so the entry can go once the API is fixed.
SEOUL_ARRIVAL_FIXES = {("0330", "2", "2", "3305", "21:08:30"): "21:08:00"}

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
    ("KR-1-P149", "금정"),
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

# Every 시발역/종착역 name of the 2026-08-28 files, weekday and holiday, written as the train map and the Seoul API
# write a destination: the KRIC name without its parenthesized suffix (신창(순천향대) -> 신창). 연천 opened after the
# 2022-08-26 code list; the train map writes 연천행.
KORAIL_TERMINI = frozenset((
    "광명", "광운대", "구로", "동두천", "동묘앞", "동인천", "병점", "부천", "부평", "서동탄", "서울",
    "소요산", "신창", "양주", "연천", "영등포", "용산", "의정부", "인천", "창동", "천안",
))
# The xlsx's short names for the underground platforms of the Seoul Metro section (S1-1-158 청량리(서울시립대입구),
# S1-1-150 서울역), which the train map and the Seoul API write as 청량리 and 서울.
KORAIL_ABBREVIATIONS = {"1지청": "청량리", "지하서": "서울"}

# One entry per line (OpenSpec add-commute-station-subway, design D8). Keys:
#   line, operator     the file's line and operator, which the server matches to a platform id
#   file               the output name before -<day type>.json
#   source             korail (an xlsx per day type) or seoul (SearchSTNTimeTableByIDService)
#   stations           (KRIC code, Korail short name or Seoul STATION_CD) in the order the file lists them
#   up_order           "listed" when up trains travel the stations in that order, "reversed" otherwise
#   served             the platforms a train must stop at to be written
#   termini, abbreviations, is_express   Korail only: see korail_destination and korail_train
LINE1 = {
    "line": "1",
    "operator": "KR",
    "file": "korail-1",
    "source": "korail",
    "stations": LINE1_STATIONS,
    "up_order": "listed",
    "served": (LINE1_SERVED,),
    "termini": KORAIL_TERMINI,
    "abbreviations": KORAIL_ABBREVIATIONS,
    "is_express": lambda train_no: train_no.startswith("1"),
    "express_rule": "numbered 1xxx",
    "revision": KORAIL_REVISION,
    "urls": {"weekday": KORAIL_WEEKDAY_URL, "holiday": KORAIL_HOLIDAY_URL},
    "sheet_prefixes": KORAIL_SHEET_PREFIXES,
}
LINE4 = {
    "line": "4",
    "operator": "S1",
    "file": "seoul-4",
    "source": "seoul",
    "stations": LINE4_STATIONS,
    "up_order": "reversed",
    "served": (LINE4_SERVED,),
}

# KRIC code and the Seoul STATION_CD (SearchInfoBySubwayNameService, 2026-10-17), in line order. Both the 잠실 window
# (213-219) and the 강남 window (219-225); 내선순환 (up) runs in this order.
LINE2 = {
    "line": "2",
    "operator": "S1",
    "file": "seoul-2",
    "source": "seoul",
    "stations": tuple(("S1-2-%d" % n, "%04d" % n) for n in range(213, 226)),
    "up_order": "listed",
    "served": ("S1-2-216", "S1-2-222"),
    # The timetable and the API name almost every circle trip 성수 in both directions; the train map writes the
    # circle instead, which says the direction.
    "circle_destination": "성수",
    "circle_labels": {"up": "내선순환", "down": "외선순환"},
    # 성수지선 and 신정지선 trips, which never stop in these windows.
    "branch_trains": ((1500, 1799), (5500, 5799)),
    # The last trips of both circles end at 삼성 (2520 inner and 2517 outer, weekday 2026-10-17).
    "two_direction_destinations": ("삼성",),
}
# 양재 (329-335) and 도곡 (331-337); up runs toward 대화, against this order.
LINE3 = {
    "line": "3",
    "operator": "S1",
    "file": "seoul-3",
    "source": "seoul",
    "stations": tuple(("S1-3-%d" % n, "%04d" % n) for n in range(329, 338)),
    "up_order": "reversed",
    "served": ("S1-3-332", "S1-3-334"),
}
# 잠실 (2812-2818); up runs toward 별내, against this order.
LINE8 = {
    "line": "8",
    "operator": "S1",
    "file": "seoul-8",
    "source": "seoul",
    "stations": tuple(("S1-8-%d" % n, "%04d" % n) for n in range(2812, 2819)),
    "up_order": "reversed",
    "served": ("S1-8-2815",),
}
LINES = (LINE1, LINE2, LINE3, LINE4, LINE8)
SEOUL_LINES = (LINE2, LINE3, LINE4, LINE8)

def station_codes(line):
    return [code for code, _ in line["stations"]]


def travel_order(line, direction):
    """The line's KRIC codes in the order a train of that direction reaches them."""
    codes = station_codes(line)
    forward = (direction == "up") == (line["up_order"] == "listed")
    return codes if forward else codes[::-1]

XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


class ConvertError(Exception):
    pass


# ---------------------------------------------------------------- shared rules

def normalize_train_no(raw):
    """K602 -> 0602, S418 -> 0418, K4302 -> 4302, 1906 -> 1906, and the Seoul timetable's Korail-run 3024K -> 3024."""
    match = re.fullmatch(r"\s*(?:[A-Z]*(\d{1,4})|(\d{4})K)\s*", raw or "")
    if match is None:
        raise ConvertError("train number %r is neither letters and at most four digits nor four digits and a K" % (raw,))
    return (match.group(1) or match.group(2)).zfill(4)


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
    """The train stops at a served station (one KRIC code or several), and its times increase along its stops."""
    served = (served,) if isinstance(served, str) else tuple(served)
    if not any(stop["station"] in served for stop in train["stops"]):
        raise ConvertError("%s: train %s (%s) has no stop at %s" % (label, train["trainNo"], train["direction"], " or ".join(served)))
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


def check_one_direction(trains, label, line):
    """No destination names trains of both directions, except one the line declares: the tracker reads a train's
    direction off its destination (toDirectionByDestination)."""
    by_direction = {d: {t["destination"] for t in trains if t["direction"] == d} for d in ("up", "down")}
    both = sorted(by_direction["up"] & by_direction["down"] - set(line.get("two_direction_destinations", ())))
    if both:
        raise ConvertError("%s: destination %s names trains of both directions" % (label, ", ".join(repr(d) for d in both)))


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


# ---------------------------------------------------------------- Korail

def korail_code(name, where, line=LINE1):
    """The KRIC code of a covered short name, None for an uncovered station; refuses a near miss."""
    names = {short: code for code, short in line["stations"]}
    if name in names:
        return names[name]
    for covered in names:
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


def sheet_direction(sheet):
    """The direction a sheet name states: a _상/_하 suffix (1호선) or a 상행/하행 suffix (수인분당), else None."""
    if sheet.endswith("상행"):
        return "up"
    if sheet.endswith("하행"):
        return "down"
    return {"상": "up", "하": "down"}.get(sheet.rsplit("_", 1)[-1])


def korail_direction(station_rows, sheet, line=LINE1):
    """up when the block lists the covered stations in up travel order, down when in down travel order."""
    codes = [code for _, _, code in station_rows if code is not None]
    if not any(code in line["served"] for code in codes):
        raise ConvertError("%s: no row of a served station (%s)" % (sheet, ", ".join(line["served"])))
    if len(set(codes)) != len(codes):
        raise ConvertError("%s: a covered station is listed twice" % sheet)
    up_order = travel_order(line, "up")
    positions = [up_order.index(code) for code in codes]
    if len(positions) < 2:
        raise ConvertError("%s: too few covered stations to tell the direction" % sheet)
    if positions == sorted(positions):
        direction = "up"
    elif positions == sorted(positions, reverse=True):
        direction = "down"
    else:
        raise ConvertError("%s: covered stations are out of line order" % sheet)
    stated = sheet_direction(sheet)
    if stated is not None and stated != direction:
        raise ConvertError("%s: the sheet name says %s but the stations run %s" % (sheet, stated, direction))
    return direction


def korail_train(rows, sheet, column, station_rows, direction, line=LINE1):
    """One train column as a train with its stops at covered stations, or None if it stops at no served station."""
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
    passes = []
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
            passes.append(code)
            continue
        elif dep is None:
            raise ConvertError("%s row %d: an arrival without a departure mid-route" % (where, row))
        if code is not None:
            stops.append({"station": code, "arr": None if arr is None else service_seconds(arr), "dep": None if dep is None else service_seconds(dep)})
    express = line["is_express"](train_no)
    if passes and not express:
        raise ConvertError("%s: train %s passes a station but is not %s" % (where, raw_no.strip(), line["express_rule"]))
    if not any(stop["station"] in line["served"] for stop in stops):
        return None
    destination = rows.get(3, {}).get(column)
    if is_blank(destination):
        raise ConvertError("%s: no 종착역" % where)
    return {"trainNo": train_no, "direction": direction, "destination": destination.strip(), "express": express, "stops": stops}


def korail_destination(name, where, line=LINE1):
    """The name the train map and the Seoul API write for a Korail 종착역; refuses a name in neither table."""
    abbreviations = line["abbreviations"]
    if name in abbreviations:
        return abbreviations[name]
    if name in line["termini"] or name in abbreviations.values():
        return name
    raise ConvertError("%s: destination %r is neither in the line's termini nor in its abbreviations; check it against the KRIC code list and the train map" % (where, name))


def with_upstream_destinations(trains, label, line=LINE1):
    return [dict(train, destination=korail_destination(train["destination"], "%s train %s" % (label, train["trainNo"]), line)) for train in trains]


def korail_sheet_selected(line, sheet, day_type):
    """1호선 reads every sheet of a day type's file whose name starts with a prefix; 수인분당 names its sheets per day type."""
    if "sheets" in line:
        return sheet in line["sheets"][day_type]
    return sheet.startswith(line["sheet_prefixes"])


def korail_trains(sheets, line=LINE1, day_type=None):
    """Every train of the selected sheets that stops at a served station."""
    trains = []
    for sheet, rows in sheets.items():
        if not korail_sheet_selected(line, sheet, day_type):
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
                station_rows.append((row, name.strip(), korail_code(name.strip(), "%s row %d" % (sheet, row), line)))
            direction = korail_direction(station_rows, sheet, line)
            for column in columns:
                train = korail_train(rows, sheet, column, station_rows, direction, line)
                if train is not None:
                    validate_train(train, line["served"], sheet)
                    trains.append(train)
    return trains


# ---------------------------------------------------------------- Seoul

def seoul_trips(rows_by_station, direction, line=LINE4):
    """Join one direction's station rows into trains, by normalized number and time continuity.

    rows_by_station: [(KRIC code, [API row, ...])] in the order the API was asked, any order.
    """
    order = travel_order(line, direction)
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
            train_no = normalize_train_no(row.get("TRAIN_NO"))
            if any(low <= int(train_no) <= high for low, high in line.get("branch_trains", ())):
                raise ConvertError("%s: a branch train, which no covered station serves" % where)
            candidates.append({
                "trainNo": train_no,
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
        destination = destinations.pop()
        if destination == line.get("circle_destination"):
            destination = line["circle_labels"][direction]
        trains.append({
            "trainNo": trip["trainNo"],
            "direction": direction,
            "destination": destination,
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


def with_arrival_fixes(rows, station_cd, week, inout):
    """The rows with each SEOUL_ARRIVAL_FIXES arrival filled in where the API wrote 00:00:00."""
    fixed = []
    for row in rows:
        key = (station_cd, week, inout, row.get("TRAIN_NO"), row.get("LEFTTIME"))
        if key in SEOUL_ARRIVAL_FIXES and row.get("ARRIVETIME") == "00:00:00":
            row = dict(row, ARRIVETIME=SEOUL_ARRIVAL_FIXES[key])
        fixed.append(row)
    return fixed


def seoul_trains(fetch, week, line=LINE4):
    trains = []
    for direction, inout in SEOUL_INOUT:
        rows_by_station = [(code, with_arrival_fixes(fetch(station_cd, week, inout), station_cd, week, inout)) for code, station_cd in line["stations"]]
        for train in seoul_trips(rows_by_station, direction, line):
            if any(stop["station"] in line["served"] for stop in train["stops"]):
                validate_train(train, line["served"], "seoul %s WEEK_TAG %s" % (line["line"], week))
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


def write(out_dir, line, document):
    name = "%s-%s.json" % (line["file"], document["dayType"])
    path = os.path.join(out_dir, name)
    if document["source"]["kind"] == "seoul-station-timetable":
        document = keep_revision(path, document)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(render(document))
    by_direction = {d: sum(1 for t in document["trains"] if t["direction"] == d) for d in ("up", "down")}
    print("%s: %d trains at %s (up %d, down %d), revision %s" % (name, len(document["trains"]), ", ".join(line["served"]), by_direction["up"], by_direction["down"], document["source"]["revision"]))


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "skkuverse-server scripts/subway-timetable"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise ConvertError("%s: HTTP %d" % (url, error.code)) from None


def read_local_or_download(local, url):
    if local:
        with open(local, "rb") as handle:
            return handle.read()
    return download(url)


def build_korail_line(out_dir, line, day_type, data):
    label = "korail %s %s" % (line["line"], day_type)
    trains = with_upstream_destinations(korail_trains(read_workbook(data), line, day_type), label, line)
    check_unique(trains, label, allow_split=False)
    check_one_direction(trains, label, line)
    document = timetable("korail-xlsx", line["urls"][day_type], line["revision"], line["operator"], line["line"], day_type, station_codes(line), trains)
    write(out_dir, line, document)


def build_korail(out_dir, weekday_file, holiday_file):
    for day_type, local in (("weekday", weekday_file), ("holiday", holiday_file)):
        build_korail_line(out_dir, LINE1, day_type, read_local_or_download(local, LINE1["urls"][day_type]))


def build_seoul(out_dir, today, lines=SEOUL_LINES):
    key = os.environ.get("SEOUL_OPENAPI_GENERAL_KEY")
    if not key:
        raise ConvertError("SEOUL_OPENAPI_GENERAL_KEY is not set; run through doppler run -p backend -c dev_personal --")

    fetched = {}

    def fetch(code, week, inout):
        fetched[(code, week, inout)] = seoul_fetch(key, code, week, inout)
        return fetched[(code, week, inout)]

    for line in lines:
        for day_type, week in SEOUL_WEEK_TAGS:
            trains = seoul_trains(fetch, week, line)
            check_unique(trains, "seoul %s %s" % (line["line"], day_type), allow_split=True)
            check_one_direction(trains, "seoul %s %s" % (line["line"], day_type), line)
            document = timetable("seoul-station-timetable", SEOUL_API, today, line["operator"], line["line"], day_type, station_codes(line), trains)
            write(out_dir, line, document)
    for (code, week, inout, train_no, left), _ in SEOUL_ARRIVAL_FIXES.items():
        rows = fetched.get((code, week, inout))
        if rows is not None and not any(r.get("TRAIN_NO") == train_no and r.get("LEFTTIME") == left and r.get("ARRIVETIME") == "00:00:00" for r in rows):
            print("convert.py: SEOUL_ARRIVAL_FIXES %s is no longer needed" % ((code, week, inout, train_no, left),), file=sys.stderr)


def main(argv=None):
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    parser = argparse.ArgumentParser(description="Build src/subway/timetable/*.json from the Korail xlsx files and the Seoul API.")
    parser.add_argument("--only", choices=("korail", "seoul"), help="build one source only")
    parser.add_argument("--line", action="append", choices=[line["line"] for line in LINES], help="build this line only; repeatable")
    parser.add_argument("--out", default=os.path.join(root, "src", "subway", "timetable"), help="output directory")
    parser.add_argument("--korail-weekday", help="a local copy of KORAIL_WEEKDAY_URL")
    parser.add_argument("--korail-holiday", help="a local copy of KORAIL_HOLIDAY_URL")
    args = parser.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
    wanted = set(args.line or [line["line"] for line in LINES])
    try:
        if args.only in (None, "korail") and "1" in wanted:
            build_korail(args.out, args.korail_weekday, args.korail_holiday)
        if args.only in (None, "seoul"):
            build_seoul(args.out, today, [line for line in SEOUL_LINES if line["line"] in wanted])
    except ConvertError as error:
        print("convert.py: %s" % error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
