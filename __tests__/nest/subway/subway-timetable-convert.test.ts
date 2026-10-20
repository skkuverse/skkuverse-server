/**
 * scripts/subway-timetable/convert.py builds the subway timetables, one file
 * per part of the subway-timetables dataset, into a pulled directory
 * (OpenSpec add-subway-arrivals, design D6; move-reference-datasets, design
 * D6). This guards the script's own rules (train-number normalization, Excel
 * fractions to seconds past midnight, refusing an unmapped Korail name,
 * joining Seoul rows) without the network or the Doppler key, through its
 * Python unittest suite. The rows it wrote are reviewed in the push report
 * (move-reference-datasets D4, D15).
 */
import { spawnSync } from "child_process";
import path from "path";

const root = path.join(__dirname, "../../..");

describe("scripts/subway-timetable/convert.py", () => {
  it("passes its unittest suite", () => {
    // Act
    const res = spawnSync("python3", ["-I", "scripts/subway-timetable/test_convert.py"], { cwd: root, encoding: "utf8" });

    // Assert
    expect(res.stderr).toMatch(/\nOK\n?$/);
    expect(res.status).toBe(0);
  });
});
