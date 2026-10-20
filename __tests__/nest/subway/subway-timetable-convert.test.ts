/**
 * scripts/subway-timetable/convert.py builds the subway timetables, one file
 * per part of the subway-timetables dataset (OpenSpec add-subway-arrivals,
 * design D6; move-reference-datasets, design D6), of which
 * src/subway/timetable/ holds the copy revision 1 is pushed from. This
 * guards three things without the network or the Doppler key:
 *
 *   - the script's own rules (train-number normalization, Excel fractions to
 *     seconds past midnight, refusing an unmapped Korail name, joining Seoul
 *     rows), through its Python unittest suite;
 *   - the committed JSON against the official sources it was built from:
 *     K602 at 성균관대 in the 2026-08-28 Korail weekday xlsx, and 4004 at 혜화
 *     in the Seoul weekday station timetable of 2026-10-16;
 *   - the Korail destinations as the upstreams name them: the xlsx writes the
 *     underground 청량리 platform as 1지청, which the train map and the Seoul
 *     API write as 청량리 (express 1912 on 2026-10-17, 의왕 접근 청량리행);
 *   - one known trip per line of OpenSpec add-commute-station-subway (design
 *     D8), and the first weekday train of each served platform and direction
 *     against the first row SearchSTNTimeTableByIDService answered on
 *     2026-10-17 for that STATION_CD and INOUT_TAG.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const root = path.join(__dirname, "../../..");

interface Stop {
  station: string;
  arr: number | null;
  dep: number | null;
}
interface Train {
  trainNo: string;
  direction: "up" | "down";
  destination: string;
  express: boolean;
  stops: Stop[];
}
interface Timetable {
  operator: string;
  line: string;
  dayType: string;
  trains: Train[];
}

const timetable = (name: string): Timetable =>
  JSON.parse(fs.readFileSync(path.join(root, "src/subway/timetable", name), "utf8")) as Timetable;

const stopOf = (file: Timetable, trainNo: string, station: string): Stop | undefined =>
  file.trains.find((t) => t.trainNo === trainNo)?.stops.find((s) => s.station === station);

describe("scripts/subway-timetable/convert.py", () => {
  it("passes its unittest suite", () => {
    // Act
    const res = spawnSync("python3", ["-I", "scripts/subway-timetable/test_convert.py"], { cwd: root, encoding: "utf8" });

    // Assert
    expect(res.stderr).toMatch(/\nOK\n?$/);
    expect(res.status).toBe(0);
  });

  it("writes K602 at 성균관대 at 06:05:00 and 06:05:30 on Korail weekdays", () => {
    // Arrange
    const weekday = timetable("korail-1-weekday.json");

    // Act
    const stop = stopOf(weekday, "0602", "KR-1-0153");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["KR", "1", "weekday"]);
    expect(stop).toEqual({ station: "KR-1-0153", arr: 6 * 3600 + 5 * 60, dep: 6 * 3600 + 5 * 60 + 30 });
  });

  it.each(["korail-1-weekday.json", "korail-1-holiday.json"])("writes the Korail expresses to the underground 청량리 as 청량리, never the xlsx's 1지청, in %s", (name) => {
    // Arrange
    const file = timetable(name);

    // Act
    const destinations = new Set(file.trains.filter((t) => t.express && t.direction === "up").map((t) => t.destination));

    // Assert
    expect(destinations).toContain("청량리");
    expect(file.trains.filter((t) => t.destination === "1지청")).toEqual([]);
  });

  it("writes the weekday express 1912 to 청량리, as the train map names it", () => {
    // Act
    const train = timetable("korail-1-weekday.json").trains.find((t) => t.trainNo === "1912");

    // Assert
    expect(train).toMatchObject({ direction: "up", destination: "청량리", express: true });
  });

  it("writes 4004 at 혜화 at 05:41:00 and 05:41:30 on Seoul weekdays", () => {
    // Arrange
    const weekday = timetable("seoul-4-weekday.json");

    // Act
    const stop = stopOf(weekday, "4004", "S1-4-420");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["S1", "4", "weekday"]);
    expect(stop).toEqual({ station: "S1-4-420", arr: 5 * 3600 + 41 * 60, dep: 5 * 3600 + 41 * 60 + 30 });
  });

  it("writes 2364 at 강남 at 18:27:30 and 18:28:00 on Seoul weekdays, an inner-circle trip the API names 성수", () => {
    // Arrange
    const weekday = timetable("seoul-2-weekday.json");

    // Act
    const train = weekday.trains.find((t) => t.trainNo === "2364");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["S1", "2", "weekday"]);
    expect(train).toMatchObject({ direction: "up", destination: "내선순환", express: false });
    expect(stopOf(weekday, "2364", "S1-2-222")).toEqual({ station: "S1-2-222", arr: 18 * 3600 + 27 * 60 + 30, dep: 18 * 3600 + 28 * 60 });
  });

  it("writes the Korail-run 3024K as 3024 at 양재 at 05:50:00 and 05:50:30 on Seoul weekdays", () => {
    // Arrange
    const weekday = timetable("seoul-3-weekday.json");

    // Act
    const train = weekday.trains.find((t) => t.trainNo === "3024");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["S1", "3", "weekday"]);
    expect(train).toMatchObject({ direction: "up", destination: "대화" });
    expect(stopOf(weekday, "3024", "S1-3-332")).toEqual({ station: "S1-3-332", arr: 5 * 3600 + 50 * 60, dep: 5 * 3600 + 50 * 60 + 30 });
  });

  it("writes the first 잠실 trip, 8004 leaving 잠실 for 별내 at 05:30:00, on Seoul weekdays", () => {
    // Arrange
    const weekday = timetable("seoul-8-weekday.json");

    // Act
    const train = weekday.trains.find((t) => t.trainNo === "8004");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["S1", "8", "weekday"]);
    expect(train).toMatchObject({ direction: "up", destination: "별내" });
    expect(train?.stops[0]).toEqual({ station: "S1-8-2815", arr: null, dep: 5 * 3600 + 30 * 60 });
  });

  it.each([
    ["seoul-2-weekday.json", "S1-2-216", "up", "2022", 5 * 3600 + 40 * 60, 5 * 3600 + 40 * 60 + 30],
    ["seoul-2-weekday.json", "S1-2-216", "down", "2001", 5 * 3600 + 35 * 60 + 30, 5 * 3600 + 36 * 60 + 30],
    ["seoul-2-weekday.json", "S1-2-222", "up", "2016", 5 * 3600 + 35 * 60 + 30, 5 * 3600 + 36 * 60],
    ["seoul-2-weekday.json", "S1-2-222", "down", "2003", 5 * 3600 + 44 * 60, 5 * 3600 + 44 * 60 + 30],
    ["seoul-3-weekday.json", "S1-3-332", "up", "3016", 5 * 3600 + 28 * 60, 5 * 3600 + 28 * 60 + 30],
    ["seoul-3-weekday.json", "S1-3-332", "down", "3001", 5 * 3600 + 43 * 60, 5 * 3600 + 43 * 60 + 30],
    ["seoul-3-weekday.json", "S1-3-334", "up", "3016", null, 5 * 3600 + 24 * 60],
    ["seoul-3-weekday.json", "S1-3-334", "down", "3001", 5 * 3600 + 47 * 60 + 30, 5 * 3600 + 48 * 60],
    ["seoul-8-weekday.json", "S1-8-2815", "up", "8004", null, 5 * 3600 + 30 * 60],
    ["seoul-8-weekday.json", "S1-8-2815", "down", "8003", 5 * 3600 + 37 * 60 + 40, 5 * 3600 + 38 * 60 + 20],
  ])("in %s, writes the first %s %s train as the service's first row, %s", (name, platformId, direction, trainNo, arr, dep) => {
    // Arrange
    const file = timetable(name);
    const timeAt = (train: Train): number => {
      const stop = train.stops.find((s) => s.station === platformId);
      return stop?.arr ?? stop?.dep ?? Number.POSITIVE_INFINITY;
    };

    // Act
    const first = file.trains.filter((t) => t.direction === direction).reduce((a, b) => (timeAt(b) < timeAt(a) ? b : a));

    // Assert
    expect(first.trainNo).toBe(trainNo);
    expect(first.stops.find((s) => s.station === platformId)).toEqual({ station: platformId, arr, dep });
  });

  it("writes the 분당 express K6300 at 정자 at 07:07:30/07:08:00 and at 도곡 at 07:39:30/07:40:00 on Korail weekdays", () => {
    // Arrange
    const weekday = timetable("korail-k1-weekday.json");

    // Act
    const train = weekday.trains.find((t) => t.trainNo === "6300");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["KR", "K1", "weekday"]);
    expect(train).toMatchObject({ direction: "up", destination: "왕십리", express: true });
    expect(stopOf(weekday, "6300", "KR-K1-K230")).toEqual({ station: "KR-K1-K230", arr: 7 * 3600 + 7 * 60 + 30, dep: 7 * 3600 + 8 * 60 });
    expect(stopOf(weekday, "6300", "KR-K1-K217")).toEqual({ station: "KR-K1-K217", arr: 7 * 3600 + 39 * 60 + 30, dep: 7 * 3600 + 40 * 60 });
  });

  it.each([
    ["down", 5 * 3600 + 34 * 60],
    ["up", 5 * 3600 + 47 * 60],
  ])("writes the first 신분당 %s train at 강남 on weekdays at the PDF's minute, %d s", (direction, seconds) => {
    // Arrange
    const weekday = timetable("shinbundang-d1-weekday.json");

    // Act
    const times = weekday.trains.filter((t) => t.direction === direction).flatMap((t) => t.stops.filter((s) => s.station === "DX-D1-4307").map((s) => s.arr ?? 0));

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["DX", "D1", "weekday"]);
    expect(Math.min(...times)).toBe(seconds);
  });
});
