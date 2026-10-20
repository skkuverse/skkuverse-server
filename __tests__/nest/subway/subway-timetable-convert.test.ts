/**
 * (An operations detail is left out of the public history.)
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
