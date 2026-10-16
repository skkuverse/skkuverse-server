/**
 * scripts/subway-timetable/convert.py builds the committed timetables in
 * src/subway/timetable/ (OpenSpec add-subway-arrivals, design D6). This
 * guards two things without the network or the Doppler key:
 *
 *   - the script's own rules (train-number normalization, Excel fractions to
 *     seconds past midnight, refusing an unmapped Korail name, joining Seoul
 *     rows), through its Python unittest suite;
 *   - the committed JSON against the official sources it was built from:
 *     K602 at 성균관대 in the 2026-08-28 Korail weekday xlsx, and 4004 at 혜화
 *     in the Seoul weekday station timetable of 2026-10-16.
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

  it("writes 4004 at 혜화 at 05:41:00 and 05:41:30 on Seoul weekdays", () => {
    // Arrange
    const weekday = timetable("seoul-4-weekday.json");

    // Act
    const stop = stopOf(weekday, "4004", "S1-4-420");

    // Assert
    expect([weekday.operator, weekday.line, weekday.dayType]).toEqual(["S1", "4", "weekday"]);
    expect(stop).toEqual({ station: "S1-4-420", arr: 5 * 3600 + 41 * 60, dep: 5 * 3600 + 41 * 60 + 30 });
  });
});
