/**
 * `npm run schedule` (scripts/set-campus-schedule.js) refuses a timetable
 * whose stop times do not follow the stop sequences stored in the bus-stops
 * dataset of the environment it writes, before writing anything. Run in this process over a real `mongod`:
 *
 *   - it reads `bus-stops` from the content database of its target, `_dev`
 *     without --prod and production with it, never the other;
 *   - a mismatch names the service, the route type and the entry time, and
 *     nothing is written;
 *   - a file with stop times is refused while the target stores no bus-stops;
 *   - --dry-run and --check run the same check.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db, MongoClient } from "mongodb";
import { busStopsFixture } from "../../helpers/bus/bus-stops";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { run } = require("../../../scripts/set-campus-schedule");
const store = require("../../../scripts/lib/datasets/store");

type DbModule = typeof import("../../../src/infra/db");

const REPO = path.join(__dirname, "../../..");
const COMMUTE_FILE = path.join(REPO, "scripts/data/commute-schedule.json");
const CONTENT = "skku_content";
const BUS_CAMPUS = "bus_campus";
const NOW = new Date("2026-10-22T03:00:00.000Z");
const OPERATOR = "operator@example.com";

interface Ran {
  code: number;
  out: string;
  err: string;
}

let mongod: TestMongod;
let dbModule: DbModule;
let client: MongoClient;
let root: string;

const contentDb = (prod: boolean): Db => client.db(prod ? CONTENT : `${CONTENT}_dev`);
const schedules = (prod: boolean) => client.db(prod ? BUS_CAMPUS : `${BUS_CAMPUS}_dev`).collection("bus_schedules");

/** Runs the tool as `npm run schedule -- <argv>` would, against the test mongod. */
async function schedule(argv: string[]): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: { MONGO_URL: mongod.uri, MONGO_DB_NAME_BUS_CAMPUS: BUS_CAMPUS, MONGO_CONTENT_DB_NAME: CONTENT },
    out: (line = "") => out.push(`${line}\n`),
    err: (line = "") => err.push(`${line}\n`),
    now: () => NOW,
  });
  return { code, out: out.join(""), err: err.join("") };
}

const commuteTimetable = () => JSON.parse(fs.readFileSync(COMMUTE_FILE, "utf8"));

/** Writes `raw` as a timetable file and returns its path. */
function timetableFile(raw: unknown): string {
  const file = path.join(root, "commute-schedule.json");
  fs.writeFileSync(file, JSON.stringify(raw));
  return file;
}

const gangnamEntries = (raw: { patterns: Array<{ serviceIds: string[]; entries: Array<{ routeType: string; stopTimes: Array<string | null> }> }> }, routeType: string) =>
  raw.patterns.filter((p) => p.serviceIds.includes("commute-gangnam-yangjae")).flatMap((p) => p.entries.filter((e) => e.routeType === routeType));

/** Revision 1 of bus-stops with a fourth stop on the 강남·양재 하교 run. */
function withFourthDownStop(): Record<string, any> {
  const data = busStopsFixture() as Record<string, any>;
  data.sequences["commute-gangnam-yangjae"].down.push({ stopId: "jamsil-exit5", action: "alight", timing: "estimated" });
  return data;
}

beforeAll(async () => {
  mongod = await startMongod();
  dbModule = require("../../../src/infra/db") as DbModule;
  assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
  client = dbModule.getClient();
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await dbModule?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "set-campus-schedule-"));
  for (const name of [CONTENT, `${CONTENT}_dev`, BUS_CAMPUS, `${BUS_CAMPUS}_dev`]) await client.db(name).dropDatabase();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("npm run schedule against the stored bus-stops sequences", () => {
  it("writes the committed commute timetable to _dev when its stop times follow _dev's sequences", async () => {
    // Arrange
    await store.create(contentDb(false), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });

    // Act
    const result = await schedule(["--file", COMMUTE_FILE, "--create"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toContain(`stops      ${CONTENT}_dev bus-stops revision 1`);
    expect(await schedules(false).countDocuments()).toBe(5);
  });

  it("One time short: refuses a 강남·양재 등교 entry with two times for a three-stop sequence, naming the service and the entry time, and writes nothing", async () => {
    // Arrange
    await store.create(contentDb(false), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });
    const raw = commuteTimetable();
    const [first] = gangnamEntries(raw, "up");
    first!.stopTimes = [first!.stopTimes[0]!, first!.stopTimes[2]!];
    const file = timetableFile(raw);

    // Act
    const result = await schedule(["--file", file, "--create"]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("commute-gangnam-yangjae up 07:40 (pilot): 2 stop times for a sequence of 3 stops");
    expect(result.err).toContain("nothing written");
    expect(await schedules(false).countDocuments()).toBe(0);
  });

  it("Production checked against production: a file with three times per 하교 run writes with --prod against production's three stops, and is refused against _dev's four", async () => {
    // Arrange
    await store.create(contentDb(false), "bus-stops", withFourthDownStop(), { by: OPERATOR, now: NOW });
    await store.create(contentDb(true), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });

    // Act
    const prod = await schedule(["--file", COMMUTE_FILE, "--create", "--prod"]);
    const dev = await schedule(["--file", COMMUTE_FILE, "--create"]);

    // Assert
    expect(prod.code).toBe(0);
    expect(prod.out).toContain(`stops      ${CONTENT} bus-stops revision 1`);
    expect(await schedules(true).countDocuments()).toBe(5);
    expect(dev.code).toBe(1);
    expect(dev.err).toContain("commute-gangnam-yangjae down 17:00 (pilot): 3 stop times for a sequence of 4 stops");
    expect(await schedules(false).countDocuments()).toBe(0);
  });

  it("Dataset not stored: refuses a file with stop times, naming bus-stops as not stored, and writes nothing", async () => {
    // Arrange
    await store.create(contentDb(true), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });

    // Act
    const result = await schedule(["--file", COMMUTE_FILE, "--create"]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`bus-stops is not stored in ${CONTENT}_dev`);
    expect(await schedules(false).countDocuments()).toBe(0);
  });

  it("writes a file without stop times while no bus-stops is stored, since there is nothing to align", async () => {
    // Arrange
    const raw = { semester: "2026-2", effectiveFrom: "2026-08-31", routeTypes: ["regular"], patterns: [{ patternId: "weekday", days: [1], serviceIds: ["fasttrack-inja"], entries: [{ time: "08:00", routeType: "regular", busCount: 1, notes: null }] }] };

    // Act
    const result = await schedule(["--file", timetableFile(raw), "--create"]);

    // Assert
    expect(result.code).toBe(0);
    expect(await schedules(false).countDocuments()).toBe(1);
  });

  it("--dry-run and --check run the same check: each refuses the mismatch, and --dry-run passes the committed file", async () => {
    // Arrange
    await store.create(contentDb(false), "bus-stops", withFourthDownStop(), { by: OPERATOR, now: NOW });
    await store.create(contentDb(true), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });

    // Act
    const dryRun = await schedule(["--file", COMMUTE_FILE, "--dry-run"]);
    const check = await schedule(["--file", COMMUTE_FILE, "--check"]);
    const prodDryRun = await schedule(["--file", COMMUTE_FILE, "--dry-run", "--prod"]);

    // Assert
    expect([dryRun.code, check.code]).toEqual([1, 1]);
    for (const { err } of [dryRun, check]) expect(err).toContain("commute-gangnam-yangjae down 17:00 (pilot): 3 stop times for a sequence of 4 stops");
    expect(prodDryRun.code).toBe(0);
    expect(prodDryRun.err).not.toContain("stop times for a sequence");
    expect(await schedules(true).countDocuments()).toBe(0);
  });
});

// A pattern that serves no date from today on (2026-10-22 in KST at NOW) is left out of the
// check and named as skipped, as `npm run data -- push bus-stops` leaves it out; one ending today is still checked.
describe("npm run schedule with a pattern no longer served", () => {
  it.each([
    ["2026-10-21", 0],
    ["2026-10-22", 1],
    ["2026-10-23", 1],
  ])("writes three 하교 times against four stops only when the file ends before today: ending %s exits %d", async (until, code) => {
    // Arrange
    await store.create(contentDb(false), "bus-stops", withFourthDownStop(), { by: OPERATOR, now: NOW });
    const file = timetableFile({ ...commuteTimetable(), effectiveUntil: until });

    // Act
    const result = await schedule(["--file", file, "--create"]);

    // Assert
    expect(result.code).toBe(code);
    expect(result.out.includes(`skipped    commute-gangnam-yangjae/pilot ended ${until}, before today 2026-10-22 (KST)`)).toBe(code === 0);
    expect(result.err.includes("commute-gangnam-yangjae down 17:00 (pilot): 3 stop times for a sequence of 4 stops")).toBe(code === 1);
    expect(await schedules(false).countDocuments()).toBe(code === 0 ? 5 : 0);
  });
});

describe("npm run schedule from the command line", () => {
  it("prints a usage error to stderr and exits 1, before reading .env's database", () => {
    // Act
    const result = spawnSync(process.execPath, [path.join(REPO, "scripts/set-campus-schedule.js"), "--bogus"], { encoding: "utf8" });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe("unknown argument: --bogus");
  });
});
