#!/usr/bin/env python3
"""Unit tests of convert.py, without the network or the Doppler key.

Run from the repository root (jest runs it from __tests__/nest/subway/subway-timetable-convert.test.ts):

    python3 -I scripts/subway-timetable/test_convert.py

The Korail tests build a small xlsx in memory with the layout of the 2026-08-28 files: row 2 시발역,
row 3 종착역, row 4 열차번호, then two rows per station (arrival with the name, departure below).
"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)

import convert  # noqa: E402

TIMETABLE_DIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "src", "subway", "timetable")


def column_letter(index):
    letters = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def xlsx(sheets):
    """xlsx bytes from {sheet name: {(row, column): str | float}}, strings inline."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        entries = "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (escape(name), i + 1, i + 1) for i, name in enumerate(sheets))
        archive.writestr("xl/workbook.xml", '<workbook xmlns="%s" xmlns:r="%s"><sheets>%s</sheets></workbook>' % (convert.XLSX_NS, convert.REL_NS, entries))
        rels = "".join('<Relationship Id="rId%d" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(len(sheets)))
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="%s">%s</Relationships>' % (convert.PKG_REL_NS, rels))
        for i, cells in enumerate(sheets.values()):
            rows = {}
            for (row, column), value in cells.items():
                rows.setdefault(row, []).append((column, value))
            xml_rows = []
            for row in sorted(rows):
                xml_cells = []
                for column, value in sorted(rows[row]):
                    ref = "%s%d" % (column_letter(column), row)
                    if isinstance(value, str):
                        xml_cells.append('<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, escape(value)))
                    else:
                        xml_cells.append('<c r="%s"><v>%r</v></c>' % (ref, value))
                xml_rows.append('<row r="%d">%s</row>' % (row, "".join(xml_cells)))
            archive.writestr("xl/worksheets/sheet%d.xml" % (i + 1), '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>' % (convert.XLSX_NS, "".join(xml_rows)))
    return buffer.getvalue()


def fraction(hh, mm, ss=0):
    return (hh * 3600 + mm * 60 + ss) / 86400.0


def korail_sheet(stations, trains):
    """Cells of one block: stations is a list of names in row order; trains maps a column to
    (train number, origin, destination, {station name: (arrival fraction | None, departure fraction | None)})."""
    cells = {(2, 0): "시발역", (3, 0): "종착역", (4, 0): "열차번호"}
    for index, name in enumerate(stations):
        cells[(5 + 2 * index, 0)] = name + "  "
    for column, (number, origin, destination, times) in trains.items():
        cells[(2, column)] = origin + "  "
        cells[(3, column)] = destination + " "
        cells[(4, column)] = number
        for index, name in enumerate(stations):
            arr, dep = times.get(name, (None, None))
            cells[(5 + 2 * index, column)] = "        " if arr is None else arr
            if dep is not None:
                cells[(6 + 2 * index, column)] = dep
    return cells


UP_STATIONS = ["천안", "수원", "화서", "성균관", "의왕", "군포", "금정"]


class TrainNumbers(unittest.TestCase):
    def test_strips_letters_and_pads_to_four_digits(self):
        # Arrange
        cases = {"K602": "0602", "S418": "0418", "K4302": "4302", "1906": "1906", "K1902": "1902", " K602 ": "0602"}

        # Act
        normalized = {raw: convert.normalize_train_no(raw) for raw in cases}

        # Assert
        self.assertEqual(normalized, cases)

    def test_refuses_what_is_not_a_train_number(self):
        for raw in ("K12345", "열차번호", "", "K60A"):
            with self.subTest(raw=raw):
                # Act & Assert
                with self.assertRaises(convert.ConvertError):
                    convert.normalize_train_no(raw)


class Times(unittest.TestCase):
    def test_excel_fraction_becomes_seconds_after_the_service_day_start(self):
        # Arrange
        cases = [
            (0.2534722222222222, 21900),  # 06:05:00, K602 at 성균관 in the 2026-08-28 file
            (0.25381944444444443, 21930),  # 06:05:30
            (fraction(0, 13, 30), 87210),  # after midnight
            (1 + fraction(0, 13, 30), 87210),  # a fraction past 1.0 is the same clock time
            (fraction(2, 59, 30), 86400 + 10770),  # just before the service day starts
            (fraction(3, 0), 10800),  # the service day start itself
        ]

        # Act
        seconds = [convert.service_seconds(convert.excel_seconds(f, "test")) for f, _ in cases]

        # Assert
        self.assertEqual(seconds, [expected for _, expected in cases])

    def test_excel_value_that_is_not_a_time_is_refused(self):
        # Act & Assert
        with self.assertRaises(convert.ConvertError):
            convert.excel_seconds(-0.1, "test")

    def test_seoul_clock_times_past_24_and_the_zero_sentinel(self):
        # Arrange
        cases = {"05:41:00": 20460, "24:13:30": 87210, "25:00:00": 90000, "00:00:00": None}

        # Act
        seconds = {value: convert.hms_seconds(value, "test") for value in cases}

        # Assert
        self.assertEqual(seconds, cases)

    def test_seoul_time_in_another_format_is_refused(self):
        for value in ("5:41:00", "05:41", "", None):
            with self.subTest(value=value):
                # Act & Assert
                with self.assertRaises(convert.ConvertError):
                    convert.hms_seconds(value, "test")


class KorailNames(unittest.TestCase):
    def test_maps_the_eight_covered_short_names(self):
        # Arrange
        names = ["병점", "세류", "수원", "화서", "성균관", "의왕", "당정", "군포"]

        # Act
        codes = [convert.korail_code(name, "test") for name in names]

        # Assert
        self.assertEqual(codes, ["KR-1-P157", "KR-1-1715", "KR-1-P155", "KR-1-P154", "KR-1-0153", "KR-1-P152", "KR-1-P151", "KR-1-P150"])

    def test_leaves_other_stations_unmapped(self):
        # Act & Assert
        self.assertEqual([convert.korail_code(name, "test") for name in ("서동탄", "세마", "1지청", "금정")], [None, None, None, None])

    def test_refuses_a_covered_looking_name_with_the_sheet_and_row(self):
        # Arrange
        cells = korail_sheet(["화서", "성균관대", "의왕"], {1: ("K602", "천안", "1지청", {"화서": (None, fraction(6, 3))})})
        workbook = convert.read_workbook(xlsx({"경부장항_평일_상": cells}))

        # Act
        with self.assertRaises(convert.ConvertError) as caught:
            convert.korail_trains(workbook)

        # Assert
        self.assertIn("경부장항_평일_상 row 7", str(caught.exception))
        self.assertIn("성균관대", str(caught.exception))


class KorailWorkbook(unittest.TestCase):
    def setUp(self):
        local = {name: (fraction(6, m), fraction(6, m, 30)) for name, m in zip(UP_STATIONS, range(0, 14, 2))}
        local["천안"] = (None, fraction(6, 0, 30))
        local["금정"] = (fraction(6, 12), None)
        express = {
            "천안": (None, fraction(7, 0)),
            "수원": (fraction(7, 10), fraction(7, 11)),
            "화서": (None, fraction(7, 12)),  # a pass: a departure-row time only
            "성균관": (fraction(7, 14), fraction(7, 14, 30)),
            "금정": (fraction(7, 20), None),
        }
        late = {"성균관": (None, fraction(23, 58)), "의왕": (fraction(23, 59, 30), fraction(0, 0)), "군포": (fraction(0, 2), None)}
        skips = {"천안": (None, fraction(8, 0)), "수원": (fraction(8, 10), None)}
        self.cells = korail_sheet(UP_STATIONS, {1: ("K602", "천안", "1지청", local), 2: ("K1902", "천안", "서울", express), 3: ("S418", "성균관", "구로", late), 4: ("K604", "천안", "수원", skips)})

    def trains(self, cells=None, sheet="경부장항_평일_상"):
        return {t["trainNo"]: t for t in convert.korail_trains(convert.read_workbook(xlsx({sheet: cells or self.cells, "경인_평일_상": {(4, 0): "열차번호"}})))}

    def test_reads_stops_at_covered_stations_in_travel_order(self):
        # Act
        train = self.trains()["0602"]

        # Assert
        self.assertEqual(train["direction"], "up")
        self.assertEqual(train["destination"], "1지청")
        self.assertFalse(train["express"])
        self.assertEqual([s["station"] for s in train["stops"]], ["KR-1-P155", "KR-1-P154", "KR-1-0153", "KR-1-P152", "KR-1-P150"])
        self.assertEqual(train["stops"][2], {"station": "KR-1-0153", "arr": 6 * 3600 + 6 * 60, "dep": 6 * 3600 + 6 * 60 + 30})

    def test_keeps_only_trains_that_stop_at_the_served_station_and_ignores_other_sheets(self):
        # Act
        numbers = sorted(self.trains())

        # Assert
        self.assertEqual(numbers, ["0418", "0602", "1902"])

    def test_express_passes_are_not_stops(self):
        # Act
        train = self.trains()["1902"]

        # Assert
        self.assertTrue(train["express"])
        self.assertEqual([s["station"] for s in train["stops"]], ["KR-1-P155", "KR-1-0153"])

    def test_origin_and_terminus_have_one_time_and_midnight_rolls_over(self):
        # Act
        stops = self.trains()["0418"]["stops"]

        # Assert
        self.assertEqual(stops, [
            {"station": "KR-1-0153", "arr": None, "dep": 23 * 3600 + 58 * 60},
            {"station": "KR-1-P152", "arr": 23 * 3600 + 59 * 60 + 30, "dep": 86400},
            {"station": "KR-1-P150", "arr": 86400 + 120, "dep": None},
        ])

    def test_a_pass_on_a_train_not_numbered_1xxx_is_refused(self):
        # Arrange
        cells = dict(self.cells)
        cells[(2 * UP_STATIONS.index("화서") + 5, 1)] = "        "

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "passes a station"):
            self.trains(cells)

    def test_a_sheet_name_that_disagrees_with_the_station_order_is_refused(self):
        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "sheet name says down"):
            self.trains(sheet="경부장항_평일_하")


class KorailDestinations(unittest.TestCase):
    def test_maps_each_abbreviation_to_the_name_the_upstreams_write(self):
        # Act
        names = {name: convert.korail_destination(name, "test") for name in ("1지청", "지하서")}

        # Assert
        self.assertEqual(names, {"1지청": "청량리", "지하서": "서울"})

    def test_keeps_a_terminus_the_xlsx_writes_in_full(self):
        # Arrange
        termini = ["광운대", "구로", "동묘앞", "서울", "병점", "서동탄", "천안", "신창", "용산", "연천"]

        # Act
        names = [convert.korail_destination(name, "test") for name in termini]

        # Assert
        self.assertEqual(names, termini)

    def test_refuses_a_name_in_neither_table_with_where(self):
        for name in ("2지청", "지하청", "청량", ""):
            with self.subTest(name=name):
                # Act
                with self.assertRaises(convert.ConvertError) as caught:
                    convert.korail_destination(name, "korail weekday train 0602")

                # Assert
                self.assertIn("korail weekday train 0602", str(caught.exception))
                self.assertIn(repr(name), str(caught.exception))


class KorailBuild(unittest.TestCase):
    def setUp(self):
        local = {name: (fraction(6, m), fraction(6, m, 30)) for name, m in zip(UP_STATIONS, range(0, 14, 2))}
        local["천안"] = (None, fraction(6, 0, 30))
        local["금정"] = (fraction(6, 12), None)
        express = {"천안": (None, fraction(7, 0)), "수원": (fraction(7, 10), fraction(7, 11)), "성균관": (fraction(7, 14), fraction(7, 14, 30)), "금정": (fraction(7, 20), None)}
        self.trains = {1: ("K602", "천안", "1지청", local), 2: ("K1912", "천안", "1지청", express), 3: ("K1902", "천안", "서울", express)}

    def build(self, trains):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        directory = scratch.name
        path = os.path.join(directory, "korail.xlsx")
        with open(path, "wb") as handle:
            handle.write(xlsx({"경부장항_평일_상": korail_sheet(UP_STATIONS, trains)}))
        with contextlib.redirect_stdout(io.StringIO()):
            convert.build_korail(directory, path, path)
        with open(os.path.join(directory, "korail-1-weekday.json"), encoding="utf-8") as handle:
            return {t["trainNo"]: t["destination"] for t in json.load(handle)["trains"]}

    def test_writes_each_train_with_the_destination_the_upstreams_write(self):
        # Act
        destinations = self.build(self.trains)

        # Assert
        self.assertEqual(destinations, {"0602": "청량리", "1902": "서울", "1912": "청량리"})

    def test_refuses_a_destination_in_neither_table_and_names_the_train(self):
        # Arrange
        trains = dict(self.trains)
        trains[1] = ("K602", "천안", "2지청", trains[1][3])

        # Act
        with self.assertRaises(convert.ConvertError) as caught:
            self.build(trains)

        # Assert
        self.assertIn("0602", str(caught.exception))
        self.assertIn("'2지청'", str(caught.exception))


class SeoulTrips(unittest.TestCase):
    @staticmethod
    def row(number, arrive, leave, destination="진접"):
        return {"TRAIN_NO": number, "ARRIVETIME": arrive, "LEFTTIME": leave, "SUBWAYENAME": destination + " ", "EXPRESS_YN": "G"}

    def test_joins_a_train_across_stations_in_travel_order(self):
        # Arrange
        rows = [
            ("S1-4-419", [self.row("4004", "05:43:00", "05:43:30")]),
            ("S1-4-420", [self.row("4004", "05:41:00", "05:41:30")]),
            ("S1-4-421", [self.row("4004", "05:38:30", "05:39:00")]),
        ]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual(len(trains), 1)
        self.assertEqual(trains[0]["destination"], "진접")
        self.assertEqual([s["station"] for s in trains[0]["stops"]], ["S1-4-421", "S1-4-420", "S1-4-419"])
        self.assertEqual(trains[0]["stops"][1], {"station": "S1-4-420", "arr": 20460, "dep": 20490})

    def test_a_repeated_number_splits_by_time_continuity(self):
        # Arrange
        rows = [
            ("S1-4-420", [self.row("K4302", "06:11:00", "06:11:30", "불암산"), self.row("4302", "20:11:00", "20:11:30", "불암산")]),
            ("S1-4-419", [self.row("4302", "20:13:00", "20:13:30", "불암산"), self.row("K4302", "06:13:00", "06:13:30", "불암산")]),
        ]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual([[s["arr"] for s in t["stops"]] for t in trains], [[22260, 22380], [72660, 72780]])
        self.assertTrue(all(t["_split"] for t in trains))

    def test_a_later_row_past_the_hop_limit_starts_a_new_run(self):
        # Arrange
        rows = [
            ("S1-4-421", [self.row("K4302", "06:09:00", "06:09:30", "불암산")]),
            ("S1-4-420", [self.row("K4302", "06:11:00", "06:11:30", "불암산")]),
            ("S1-4-419", [self.row("4302", "20:13:00", "20:13:30", "불암산")]),
        ]

        # Act
        trains = convert.seoul_trips(rows, "up")

        # Assert
        self.assertEqual([[s["station"] for s in t["stops"]] for t in trains], [["S1-4-421", "S1-4-420"], ["S1-4-419"]])

    def test_zero_sentinel_marks_an_origin(self):
        # Arrange
        rows = [("S1-4-419", [self.row("4509", "00:00:00", "05:33:30", "오이도")]), ("S1-4-420", [self.row("4509", "05:35:00", "05:35:30", "오이도")])]

        # Act
        stops = convert.seoul_trips(rows, "down")[0]["stops"]

        # Assert
        self.assertEqual(stops[0], {"station": "S1-4-419", "arr": None, "dep": 20010})

    def test_an_unknown_express_code_is_refused(self):
        # Arrange
        row = dict(self.row("4004", "05:41:00", "05:41:30"), EXPRESS_YN="X")

        # Act & Assert
        with self.assertRaisesRegex(convert.ConvertError, "EXPRESS_YN"):
            convert.seoul_trips([("S1-4-420", [row])], "up")


class CommittedTimetables(unittest.TestCase):
    NAMES = ["korail-1-weekday.json", "korail-1-holiday.json", "seoul-4-weekday.json", "seoul-4-saturday.json", "seoul-4-holiday.json"]

    def test_each_file_is_rendered_as_the_script_writes_it_and_passes_its_checks(self):
        for name in self.NAMES:
            with self.subTest(name=name):
                # Arrange
                with open(os.path.join(TIMETABLE_DIR, name), encoding="utf-8") as handle:
                    text = handle.read()
                document = json.loads(text)
                served = convert.LINE1_SERVED if document["line"] == "1" else convert.LINE4_SERVED

                # Act
                for train in document["trains"]:
                    convert.validate_train(train, served, name)

                # Assert
                self.assertEqual(convert.render(document), text)
                self.assertEqual(document["trains"], convert.sort_trains(document["trains"]))

    def test_each_korail_destination_is_a_name_the_upstreams_write(self):
        for name in self.NAMES[:2]:
            with self.subTest(name=name):
                # Arrange
                with open(os.path.join(TIMETABLE_DIR, name), encoding="utf-8") as handle:
                    document = json.load(handle)

                # Act
                destinations = {train["destination"] for train in document["trains"]}

                # Assert
                self.assertEqual({d: convert.korail_destination(d, name) for d in destinations}, {d: d for d in destinations})

    def test_no_destination_names_trains_of_both_directions(self):
        # The tracker reads a train's direction off its destination in these files (toDirectionByDestination).
        for name in self.NAMES:
            with self.subTest(name=name):
                # Arrange
                with open(os.path.join(TIMETABLE_DIR, name), encoding="utf-8") as handle:
                    document = json.load(handle)

                # Act
                by_direction = {d: {t["destination"] for t in document["trains"] if t["direction"] == d} for d in ("up", "down")}

                # Assert
                self.assertEqual(by_direction["up"] & by_direction["down"], set())


if __name__ == "__main__":
    unittest.main(verbosity=1)
