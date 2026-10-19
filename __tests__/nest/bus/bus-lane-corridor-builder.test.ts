/**
 * scripts/build-bus-lane-corridor.js feeds the `bus-lane-corridor` dataset
 * (move-reference-datasets task 3.6, design D9; spec "The corridor builder
 * writes a working file"): it rebuilds the centerline, its boundaries and the
 * probe routes' section ranges into a working file `npm run data -- pull`
 * wrote, in place, keeping the entry and exit points and the pull's revision,
 * so `push` sends the result. It writes nothing under src/, refuses a file the
 * tool did not write, and its probe and entry-exit checks read the same file.
 *
 * The script runs as a child process over a saved Overpass answer and a
 * directory of TOPIS answers (fixtures/bus-lane-corridor-builder/, synthetic:
 * a straight corridor 25.6 km long), so it fetches nothing. Its output passes
 * the server's own push checks.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { corridorIssues } from "../../../src/bus/eta/lane/bus-eta-lane.rules";
import { laneCorridorDataset } from "../../../src/bus/eta/lane/bus-eta-lane.schema";
import { corridorFixture } from "../../helpers/bus/bus-lane-corridor";

const ROOT = path.join(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/build-bus-lane-corridor.js");
const SOURCES = path.join(__dirname, "fixtures/bus-lane-corridor-builder");
const COMMITTED_LANE_FILE = path.join(ROOT, "src/bus/eta/lane/bus-lane.json");

const PULLED = { dataset: "bus-lane-corridor", target: "dev", baseRevision: 3, pulledAt: "2026-10-20T03:00:00.000Z" };

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bus-lane-corridor-builder-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A working file as `pull` writes it, holding revision 1 of the corridor; returns its path. */
function pulledWorkingFile(envelope: Record<string, unknown> = PULLED, data: unknown = corridorFixture()): string {
  const file = path.join(dir, "bus-lane-corridor.json");
  fs.writeFileSync(file, `${JSON.stringify({ ...envelope, data }, null, 2)}\n`);
  return file;
}

function runBuilder(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, SEOUL_BUS_SERVICE_KEY: "", NAVER_API_KEY_ID: "", NAVER_API_KEY: "" } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const buildArgs = (file: string): string[] => ["--file", file, "--osm", path.join(SOURCES, "overpass.json"), "--topis-dir", SOURCES];

describe("scripts/build-bus-lane-corridor.js on a pulled working file", () => {
  it("Rebuild from OSM: rewrites data.corridor and data.probeRoutes in place, keeping data.entryExit and the pull's revision", () => {
    // Arrange
    const file = pulledWorkingFile();
    const committedBefore = fs.readFileSync(COMMITTED_LANE_FILE, "utf8");

    // Act
    const run = runBuilder(buildArgs(file));

    // Assert
    expect(run).toMatchObject({ status: 0, stderr: "" });
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(written)).toEqual(["dataset", "target", "baseRevision", "pulledAt", "data"]);
    expect(written).toMatchObject(PULLED);
    expect(Object.keys(written.data)).toEqual(["corridor", "entryExit", "probeRoutes"]);
    expect(written.data.entryExit).toEqual(corridorFixture().entryExit);
    expect(written.data.corridor.boundaries).toEqual([
      { name: "한남IC", alongM: 0 },
      { name: "반포IC", alongM: 2224 },
      { name: "서초IC", alongM: 4448 },
      { name: "양재IC", alongM: 6672 },
      { name: "금토JC", alongM: 12231 },
      { name: "판교IC", alongM: 14455 },
      { name: "서울TG", alongM: 17791 },
      { name: "죽전", alongM: 21127 },
      { name: "신갈JC", alongM: 25575 },
    ]);
    expect(written.data.corridor.centerline).toHaveLength(129);
    expect(written.data.probeRoutes).toEqual([
      { routeId: "200000205", name: "8800", sectOrds: { southbound: { from: 2, to: 7 }, northbound: { from: 8, to: 13 } } },
      { routeId: "228000174", name: "5000", sectOrds: { southbound: { from: 12, to: 17 }, northbound: { from: 18, to: 23 } } },
      { routeId: "228000175", name: "5005", sectOrds: { southbound: { from: 22, to: 27 }, northbound: { from: 28, to: 33 } } },
    ]);
    expect(corridorIssues(laneCorridorDataset.parse(written.data))).toEqual([]);
    expect(fs.readFileSync(COMMITTED_LANE_FILE, "utf8")).toBe(committedBefore);
    expect(run.stdout).toContain(`wrote ${file}`);
  });

  it("--dry-run prints the summary and writes nothing", () => {
    // Arrange
    const file = pulledWorkingFile();
    const before = fs.readFileSync(file, "utf8");

    // Act
    const run = runBuilder([...buildArgs(file), "--dry-run"]);

    // Assert
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("boundaries: 한남IC 0, 반포IC 2224");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a file without the working-file wrapper, writing nothing", () => {
    // Arrange
    const file = path.join(dir, "plain.json");
    fs.writeFileSync(file, JSON.stringify(corridorFixture()));
    const before = fs.readFileSync(file, "utf8");

    // Act
    const run = runBuilder(buildArgs(file));

    // Assert
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("is not a working file written by `pull`");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a working file of another dataset, writing nothing", () => {
    // Arrange
    const file = pulledWorkingFile({ ...PULLED, dataset: "skku-rest-days" }, { "09-25": "건학기념일" });
    const before = fs.readFileSync(file, "utf8");

    // Act
    const run = runBuilder(buildArgs(file));

    // Assert
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("holds skku-rest-days, not bus-lane-corridor");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("refuses a file that does not exist, naming the pull that writes it", () => {
    // Act
    const run = runBuilder(buildArgs(path.join(dir, "missing.json")));

    // Assert
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("run `pull` first");
  });

  it("--check-probe projects the saved bus positions onto the working file's corridor", () => {
    // Arrange
    const file = pulledWorkingFile();
    runBuilder(buildArgs(file));
    const positions = path.join(dir, "positions");
    fs.mkdirSync(positions);
    const busAt = (vehId: string, sectOrd: number, lat: number) => ({ vehId, sectOrd: String(sectOrd), gpsX: "127.0502", gpsY: String(lat) });
    for (const [routeId, items] of Object.entries({ "200000205": [busAt("8800-1", 4, 37.47)], "228000174": [], "228000175": [] })) {
      fs.writeFileSync(path.join(positions, `buspos-${routeId}.json`), JSON.stringify({ msgHeader: { headerCd: "0" }, msgBody: { itemList: items } }));
    }

    // Act
    const run = runBuilder(["--file", file, "--topis-dir", SOURCES, "--check-probe", positions]);

    // Assert
    expect(run).toMatchObject({ status: 0, stderr: "" });
    expect(run.stdout).toContain("8800 8800-1 sect 4 (반포IC → 양재IC) southbound 0 m off, along 5560 m");
    expect(run.stdout).toContain('{"inRange":1,"onCorridor":1,"maxDistanceM":0,"wrongSide":0}');
  });
});
