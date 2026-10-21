/**
 * The `npm run data` command line (scripts/data.js and
 * scripts/lib/datasets/working-file.js, design D1 and D5 of
 * openspec/changes/archive/2026-10-19-move-runtime-data-to-db), run in this process over a real
 * `mongod` with the catalog loaded over `src/`:
 *
 *   - `_dev` is the target unless `--prod` is given;
 *   - `pull` writes a working file under `.data/<target>/` with the revision
 *     the edit is based on, and a file pulled from one target is never pushed
 *     to the other;
 *   - a production write needs a confirmation on a TTY or `--yes`, and
 *     `--dry-run` writes nothing;
 *   - the tool refuses to run without the compiled `dist/src`;
 *   - nothing it prints contains MONGO_URL or any part of it;
 *   - `push bus-stops` and `check` read `bus_campus.bus_schedules` of the
 *     target environment, never the other, and refuse sequences the stored
 *     stop times do not fit; `--against <timetable file>` checks against that
 *     file instead and prints the `npm run schedule` command that applies it
 *     (unify-bus-stops design D6, specs bus-stops and runtime-datasets).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db, MongoClient } from "mongodb";
import { busStopsFixture } from "../../helpers/bus/bus-stops";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, freeLoopbackPort, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { run } = require("../../../scripts/data");
const store = require("../../../scripts/lib/datasets/store");
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");

type DbModule = typeof import("../../../src/infra/db");

const REPO = path.join(__dirname, "../../..");
const srcLoader = (relativePath: string): unknown => require(path.join(REPO, "src", relativePath));

const fixture = require("../ui/fixtures/home-layout.dataset.json") as Record<string, unknown>;
const { _about, ...homeLayout } = fixture;
void _about;

const NOW = new Date("2026-10-19T03:00:00.000Z");
const OPERATOR = "operator@example.com";
const SENTINEL = "Sentinel-Pa55word-7f3c";
const USER = "datatool";
const BASE = "skku_content";
const DEV = "skku_content_dev";

interface Ran {
  code: number;
  out: string;
  err: string;
}

let mongod: TestMongod;
let dbModule: DbModule;
let client: MongoClient;
let mongoUrl: string;
let root: string;

const devDb = (): Db => client.db(DEV);
const prodDb = (): Db => client.db(BASE);

/** Runs the tool as `npm run data -- <argv>` would, against the test mongod. */
async function data(argv: string[], options: { isTTY?: boolean; answer?: string; env?: Record<string, string>; load?: unknown } = {}): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: options.env ?? { MONGO_URL: mongoUrl, MONGO_CONTENT_DB_NAME: BASE },
    root,
    load: "load" in options ? options.load : srcLoader,
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
    isTTY: options.isTTY ?? false,
    ask: async () => options.answer ?? "",
    now: () => NOW,
    whoami: () => OPERATOR,
    serverSelectionTimeoutMS: 1_000,
  });
  return { code, out: out.join(""), err: err.join("") };
}

const workingFile = (target: "dev" | "prod") => path.join(root, ".data", target, "home-layout.json");
const readWorkingFile = (target: "dev" | "prod") => JSON.parse(fs.readFileSync(workingFile(target), "utf8"));

/** Retitles the first tile grid's first tile in the working file. */
function editWorkingFile(target: "dev" | "prod", title: string): void {
  const file = readWorkingFile(target);
  const grid = file.data.sections.find((section: { type: string }) => section.type === "tile_grid");
  grid.tiles[0].title.en = title;
  fs.writeFileSync(workingFile(target), JSON.stringify(file, null, 2));
}

const revisionOf = async (db: Db): Promise<number | null> => (await store.readDataset(db, "home-layout"))?.revision ?? null;

beforeAll(async () => {
  mongod = await startMongod();
  dbModule = require("../../../src/infra/db") as DbModule;
  assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
  client = dbModule.getClient();
  // WHY: a password the tool must never print; a mongod without --auth still checks credentials it is sent.
  await client.db("admin").command({ createUser: USER, pwd: SENTINEL, roles: ["root"] });
  mongoUrl = mongod.uri.replace("mongodb://", `mongodb://${USER}:${SENTINEL}@`) + "?authSource=admin";
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await dbModule?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "data-tool-"));
  await devDb().dropDatabase();
  await prodDb().dropDatabase();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("npm run data", () => {
  it("creates a dataset in the _dev database only, without --prod", async () => {
    // Arrange
    const file = path.join(root, "home-layout.json");
    fs.writeFileSync(file, JSON.stringify(homeLayout));

    // Act
    const result = await data(["push", "home-layout", "--create", "--file", file, "--note", "import"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toContain(DEV);
    expect(await store.readDataset(devDb(), "home-layout")).toMatchObject({ revision: 1, data: homeLayout, updatedBy: OPERATOR });
    const names = (await client.db("admin").admin().listDatabases()).databases.map((d) => d.name);
    expect(names).toContain(DEV);
    expect(names).not.toContain(BASE);
  });

  it("pull writes .data/dev/home-layout.json with the revision it is based on", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });

    // Act
    const result = await data(["pull", "home-layout"]);

    // Assert
    expect(result.code).toBe(0);
    expect(readWorkingFile("dev")).toEqual({
      dataset: "home-layout",
      target: "dev",
      baseRevision: 1,
      pulledAt: NOW.toISOString(),
      data: homeLayout,
    });
  });

  it("reports no change for an unchanged push and writes nothing", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);

    // Act
    const result = await data(["push", "home-layout"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/no change/i);
    expect(await revisionOf(devDb())).toBe(1);
  });

  it("pushes an edit to _dev as the next revision, with its diff", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    editWorkingFile("dev", "Campus Map");

    // Act
    const result = await data(["push", "home-layout"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toContain("Campus Map");
    expect(await revisionOf(devDb())).toBe(2);
    expect(await revisionOf(prodDb())).toBeNull();
  });

  it("refuses a push from a stale pull, naming the current revision and its author", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    const edited = structuredClone(homeLayout) as { sections: unknown[] };
    await store.push(devDb(), "home-layout", { ...edited, sections: edited.sections.slice(1) }, { baseRevision: 1, by: "other@example.com", now: NOW });
    editWorkingFile("dev", "Campus Map");

    // Act
    const result = await data(["push", "home-layout"]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("revision 2");
    expect(result.err).toContain("other@example.com");
    expect(await revisionOf(devDb())).toBe(2);
  });

  it("refuses a push that fails the server's schema, naming the path, and writes nothing", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    const file = readWorkingFile("dev");
    const grid = file.data.sections.findIndex((section: { type: string }) => section.type === "tile_grid");
    const tile = file.data.sections[grid].tiles[0];
    tile.actoinType = tile.actionType;
    delete tile.actionType;
    fs.writeFileSync(workingFile("dev"), JSON.stringify(file));

    // Act
    const result = await data(["push", "home-layout"]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`sections.${grid}.tiles.0`);
    expect(result.err).toContain("actoinType");
    expect(await revisionOf(devDb())).toBe(1);
  });

  it("refuses a dev working file pushed with --prod", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await store.create(prodDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    editWorkingFile("dev", "Campus Map");

    // Act
    const result = await data(["push", "home-layout", "--prod", "--yes", "--file", workingFile("dev")]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/pulled from the development database/);
    expect(await revisionOf(prodDb())).toBe(1);
  });

  it("writes nothing to production without --yes on a non-TTY", async () => {
    // Arrange
    await store.create(prodDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout", "--prod"]);
    editWorkingFile("prod", "Campus Map");

    // Act
    const result = await data(["push", "home-layout", "--prod"], { isTTY: false });

    // Assert
    expect(result.code).toBe(1);
    expect(result.out).toContain(BASE);
    expect(result.out).toContain("Campus Map");
    expect(result.err).toContain("--yes");
    expect(await revisionOf(prodDb())).toBe(1);
  });

  it("writes to production with --yes, or a `y` on a TTY, and not on any other answer", async () => {
    // Arrange
    await store.create(prodDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout", "--prod"]);
    editWorkingFile("prod", "Campus Map");

    // Act
    const declined = await data(["push", "home-layout", "--prod"], { isTTY: true, answer: "yes please" });
    const confirmed = await data(["push", "home-layout", "--prod"], { isTTY: true, answer: "y" });
    editWorkingFile("prod", "Campus Map 2");
    const unattended = await data(["push", "home-layout", "--prod", "--yes"]);

    // Assert
    expect(declined.code).toBe(1);
    expect(confirmed.code).toBe(0);
    expect(unattended.code).toBe(0);
    expect(await revisionOf(prodDb())).toBe(3);
    expect(await revisionOf(devDb())).toBeNull();
  });

  it("with --prod, records a missing history entry only in a confirmed write", async () => {
    // Arrange
    // A push that stopped after storing revision 2 left it without its history entry.
    await store.create(prodDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    const edited = structuredClone(homeLayout) as { sections: unknown[] };
    await store.push(prodDb(), "home-layout", { ...edited, sections: edited.sections.slice(1) }, { baseRevision: 1, by: OPERATOR, now: NOW });
    await prodDb().collection("dataset_revisions").deleteOne({ _id: "home-layout@2" as never });
    const entryOf2 = () => prodDb().collection("dataset_revisions").findOne({ _id: "home-layout@2" as never });

    // Act
    const pulled = await data(["pull", "home-layout", "--prod"]);
    const listed = await data(["history", "home-layout", "--prod"]);
    const rollbackDeclined = await data(["rollback", "home-layout", "1", "--prod"], { isTTY: true, answer: "n" });
    editWorkingFile("prod", "Campus Map");
    const pushDeclined = await data(["push", "home-layout", "--prod"], { isTTY: true, answer: "n" });
    const unrecordedBeforeConfirming = await entryOf2();
    const confirmed = await data(["push", "home-layout", "--prod"], { isTTY: true, answer: "y" });

    // Assert
    expect([pulled, listed].map((r) => r.code)).toEqual([0, 0]);
    expect(pulled.out).toMatch(/note: home-layout revision 2 has no history entry/);
    expect(listed.out).toMatch(/note: home-layout revision 2 has no history entry/);
    expect([rollbackDeclined, pushDeclined].map((r) => r.code)).toEqual([1, 1]);
    expect(unrecordedBeforeConfirming).toBeNull();
    expect(confirmed.code).toBe(0);
    expect(await entryOf2()).toMatchObject({ revision: 2, note: "recorded by repair" });
    expect(await revisionOf(prodDb())).toBe(3);
  });

  it("writes nothing with --dry-run, after showing the diff", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    editWorkingFile("dev", "Campus Map");

    // Act
    const result = await data(["push", "home-layout", "--dry-run"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toContain("Campus Map");
    expect(await revisionOf(devDb())).toBe(1);
  });

  it("history lists revisions newest first", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    editWorkingFile("dev", "Campus Map");
    await data(["push", "home-layout", "--note", "second"]);
    editWorkingFile("dev", "Campus Map 2");
    await data(["push", "home-layout", "--note", "third"]);

    // Act
    const result = await data(["history", "home-layout"]);

    // Assert
    expect(result.code).toBe(0);
    const revisions = [...result.out.matchAll(/^\s*(\d+)\s+\d{4}-\d{2}-\d{2}T/gm)].map((m) => Number(m[1]));
    expect(revisions).toEqual([3, 2, 1]);
    expect(result.out).toContain("third");
  });

  it("history says there is no dataset yet, and writes nothing", async () => {
    // Act
    const result = await data(["history", "home-layout"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/no dataset yet/);
    const names = (await client.db("admin").admin().listDatabases()).databases.map((d) => d.name);
    expect(names).not.toContain(DEV);
  });

  it("rolls back to an earlier revision as a new one", async () => {
    // Arrange
    await store.create(devDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });
    await data(["pull", "home-layout"]);
    editWorkingFile("dev", "Campus Map");
    await data(["push", "home-layout"]);

    // Act
    const result = await data(["rollback", "home-layout", "1"]);

    // Assert
    expect(result.code).toBe(0);
    expect(await store.readDataset(devDb(), "home-layout")).toMatchObject({ revision: 3, data: homeLayout });
  });

  it("copies production's dataset into _dev and never the other way", async () => {
    // Arrange
    await store.create(prodDb(), "home-layout", homeLayout, { by: OPERATOR, now: NOW });

    // Act
    const copied = await data(["copy-prod-to-dev", "home-layout"]);
    const reversed = await data(["copy-prod-to-dev", "home-layout", "--prod"]);

    // Assert
    expect(copied.code).toBe(0);
    expect((await store.history(devDb(), "home-layout"))[0]).toMatchObject({ revision: 1, copiedFrom: { database: BASE, revision: 1 } });
    expect(reversed.code).not.toBe(0);
  });

  it("check exits non-zero on stored data the code refuses", async () => {
    // Arrange
    const broken = structuredClone(homeLayout) as { sections: Array<Record<string, unknown>> };
    broken.sections[0]!.colour = "red";
    await devDb().collection("datasets").insertOne({ _id: "home-layout" as never, revision: 1, data: broken, updatedAt: NOW, updatedBy: OPERATOR });

    // Act
    const result = await data(["check"]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("colour");
  });

  it("refuses to run without dist/src, naming npm run build", async () => {
    // Act
    const result = await data(["history", "home-layout"], { load: undefined });

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("npm run build");
  });

  it("never prints MONGO_URL or any part of it", async () => {
    // Arrange
    const file = path.join(root, "home-layout.json");
    fs.writeFileSync(file, JSON.stringify(homeLayout));
    const badPassword = { MONGO_URL: mongoUrl.replace(SENTINEL, `${SENTINEL}-wrong`), MONGO_CONTENT_DB_NAME: BASE };
    const unparsable = { MONGO_URL: `mongodb://${USER}:${SENTINEL}@127.0.0.1:notaport/`, MONGO_CONTENT_DB_NAME: BASE };

    // Act
    const runs = [
      await data(["push", "home-layout", "--create", "--file", file]),
      await data(["pull", "home-layout"]),
      await data(["push", "home-layout"]),
      await data(["history", "home-layout"]),
      await data(["check"]),
      await data(["history", "home-layout"], { env: badPassword }),
      await data(["history", "home-layout"], { env: unparsable }),
    ];

    // Assert
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 1, 1]);
    for (const { out, err } of runs) {
      expect(out + err).not.toContain(SENTINEL);
      expect(out + err).not.toContain(USER);
      expect(out + err).not.toContain(mongod.uri.replace("mongodb://", "").replace(/\/$/, ""));
    }
  });

  it("never prints the host of a MONGO_URL it cannot reach", async () => {
    // Arrange
    // The driver names the host it failed to reach (`connect ECONNREFUSED <host>:<port>`, or
    // `querySrv ENOTFOUND <cluster host>` on Atlas), so this is the message the redaction is for.
    const closed = `127.0.0.1:${await freeLoopbackPort()}`;
    const env = { MONGO_URL: `mongodb://${USER}:${SENTINEL}@${closed}/?authSource=admin`, MONGO_CONTENT_DB_NAME: BASE };

    // Act
    const result = await data(["history", "home-layout"], { env });

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("MongoServerSelectionError");
    expect(result.out + result.err).not.toContain(closed);
    expect(result.out + result.err).not.toContain(SENTINEL);
  });

  it("never prints a replica host of an SRV MONGO_URL, or an IP address, that an error names", async () => {
    // Arrange
    // An SRV URL names only the cluster host; the driver's errors name the replica hosts it resolved to, and raw IPs.
    const env = { MONGO_URL: `mongodb+srv://skku:${SENTINEL}@cluster0.abcde.mongodb.net/?retryWrites=true`, MONGO_CONTENT_DB_NAME: BASE };
    const failingWith = (message: string) => () => {
      throw new Error(message);
    };
    const messages = [
      "connection 3 to ac-abc123-shard-00-01.abcde.mongodb.net:27017 closed",
      "connect ECONNREFUSED 10.0.12.34:27017",
      "read ECONNRESET from 52.79.1.2",
    ];

    // Act
    const runs = await Promise.all(messages.map((message) => data(["history", "home-layout"], { env, load: failingWith(message) })));

    // Assert
    expect(runs.map((r) => r.code)).toEqual([1, 1, 1]);
    expect(runs[0]!.err).toContain("connection 3 to");
    for (const { out, err } of runs) {
      for (const secret of ["abcde.mongodb.net", "ac-abc123-shard-00-01", "10.0.12.34", "52.79.1.2", SENTINEL]) {
        expect(out + err).not.toContain(secret);
      }
    }
  });

  it("keeps the database banner whole when the user name is part of the database name", async () => {
    // Arrange
    const closed = `127.0.0.1:${await freeLoopbackPort()}`;
    const env = { MONGO_URL: `mongodb://skku:${SENTINEL}@${closed}/?authSource=admin`, MONGO_CONTENT_DB_NAME: BASE };

    // Act
    const result = await data(["history", "home-layout"], { env });

    // Assert
    expect(result.code).toBe(1);
    expect(result.out).toContain(`database   ${DEV}`);
    expect(result.out + result.err).not.toContain(SENTINEL);
    expect(result.out + result.err).not.toContain(closed);
  });
});

describe("npm run data bus-stops against the stored timetables", () => {
  const BUS_CAMPUS = "bus_campus";
  const env = () => ({ MONGO_URL: mongoUrl, MONGO_CONTENT_DB_NAME: BASE, MONGO_DB_NAME_BUS_CAMPUS: BUS_CAMPUS });
  const COMMUTE_FILE = path.join(REPO, "scripts/data/commute-schedule.json");
  const commuteTimetable = () => JSON.parse(fs.readFileSync(COMMUTE_FILE, "utf8"));
  const timetableDocs = (raw: unknown): Array<Record<string, any>> => buildDocuments(parseTimetableFile(raw));
  // The commute timetable with one more time on every 강남·양재 하교 run, for a fourth stop.
  const withFourthDownTime = () => {
    const raw = commuteTimetable();
    for (const pattern of raw.patterns.filter((p: { serviceIds: string[] }) => p.serviceIds.includes("commute-gangnam-yangjae"))) {
      for (const entry of pattern.entries.filter((e: { routeType: string }) => e.routeType === "down")) entry.stopTimes.push(null);
    }
    return raw;
  };
  const seed = async (database: string, raw: unknown) => {
    await client.db(database).collection("bus_schedules").insertMany(timetableDocs(raw));
  };
  const stopsFile = () => {
    const file = path.join(root, "bus-stops.json");
    fs.writeFileSync(file, JSON.stringify(busStopsFixture()));
    return file;
  };

  beforeEach(async () => {
    await client.db(`${BUS_CAMPUS}_dev`).dropDatabase();
    await client.db(BUS_CAMPUS).dropDatabase();
  });

  it("Production push reads production timetables: a push to _dev is checked against _dev's, and one with --prod against production's", async () => {
    // Arrange
    await seed(`${BUS_CAMPUS}_dev`, withFourthDownTime());
    await seed(BUS_CAMPUS, commuteTimetable());
    const file = stopsFile();

    // Act
    const dev = await data(["push", "bus-stops", "--create", "--file", file], { env: env() });
    const prod = await data(["push", "bus-stops", "--create", "--file", file, "--prod", "--yes"], { env: env() });

    // Assert
    expect(dev.code).toBe(1);
    expect(dev.out).toContain(`reads      ${BUS_CAMPUS}_dev.bus_schedules`);
    expect(dev.err).toContain("sequences.commute-gangnam-yangjae.down");
    expect(dev.err).toContain("commute-gangnam-yangjae down 17:00 (pilot): 4 stop times for a sequence of 3 stops");
    expect(await store.readDataset(devDb(), "bus-stops")).toBeNull();
    expect(prod.code).toBe(0);
    expect(prod.out).toContain(`reads      ${BUS_CAMPUS}.bus_schedules`);
    expect(prod.out).not.toContain(`${BUS_CAMPUS}_dev`);
    expect((await store.readDataset(prodDb(), "bus-stops"))?.revision).toBe(1);
  });

  it("Check reads the same: check --prod refuses against production's timetables, and check against _dev's passes, writing nothing", async () => {
    // Arrange
    await store.create(devDb(), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });
    await store.create(prodDb(), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });
    await seed(`${BUS_CAMPUS}_dev`, commuteTimetable());
    await seed(BUS_CAMPUS, withFourthDownTime());
    const stored = await client.db(BUS_CAMPUS).collection("bus_schedules").find().toArray();

    // Act
    const prod = await data(["check", "bus-stops", "--prod"], { env: env() });
    const dev = await data(["check", "bus-stops"], { env: env() });

    // Assert
    expect(prod.code).toBe(1);
    expect(prod.err).toContain("commute-gangnam-yangjae down 17:00 (pilot): 4 stop times for a sequence of 3 stops");
    expect(dev.code).toBe(0);
    expect(await client.db(BUS_CAMPUS).collection("bus_schedules").find().toArray()).toEqual(stored);
  });

  it("Sequence pushed with its timetable: refuses a fourth 하교 stop against the stored entries, stores it --against the file that lists four, and names the npm run schedule command", async () => {
    // Arrange
    await seed(`${BUS_CAMPUS}_dev`, commuteTimetable());
    await store.create(devDb(), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });
    await data(["pull", "bus-stops"], { env: env() });
    const working = path.join(root, ".data", "dev", "bus-stops.json");
    const pulled = JSON.parse(fs.readFileSync(working, "utf8"));
    pulled.data.sequences["commute-gangnam-yangjae"].down.push({ stopId: "jamsil-exit5", action: "alight", timing: "estimated" });
    fs.writeFileSync(working, JSON.stringify(pulled));
    const next = path.join(root, "commute-schedule.json");
    fs.writeFileSync(next, JSON.stringify(withFourthDownTime()));

    // Act
    const alone = await data(["push", "bus-stops"], { env: env() });
    const against = await data(["push", "bus-stops", "--against", next], { env: env() });

    // Assert
    expect(alone.code).toBe(1);
    expect(alone.err).toContain("commute-gangnam-yangjae down 17:00 (pilot): 3 stop times for a sequence of 4 stops");
    expect(against.code).toBe(0);
    expect(against.out).toContain(`with ${next} in place of its documents of the same service and pattern`);
    expect(against.out).toContain(`npm run schedule -- --file ${next}`);
    expect(against.out).not.toContain(`npm run schedule -- --file ${next} --prod`);
    expect((await store.readDataset(devDb(), "bus-stops"))?.revision).toBe(2);
    expect(await client.db(`${BUS_CAMPUS}_dev`).collection("bus_schedules").find({}, { projection: { _id: 0 } }).toArray()).toEqual(timetableDocs(commuteTimetable()));
  });

  it("Rollback of a length change: refuses the three-stop revision against the stored four-time entries, and rolls back --against the file that lists three", async () => {
    // Arrange
    await seed(`${BUS_CAMPUS}_dev`, withFourthDownTime());
    await store.create(devDb(), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });
    const fourStops = busStopsFixture() as Record<string, any>;
    fourStops.sequences["commute-gangnam-yangjae"].down.push({ stopId: "jamsil-exit5", action: "alight", timing: "estimated" });
    await store.push(devDb(), "bus-stops", fourStops, { baseRevision: 1, by: OPERATOR, now: NOW });
    const previous = path.join(root, "commute-schedule.json");
    fs.writeFileSync(previous, JSON.stringify(commuteTimetable()));

    // Act
    const alone = await data(["rollback", "bus-stops", "1"], { env: env() });
    const against = await data(["rollback", "bus-stops", "1", "--against", previous], { env: env() });

    // Assert
    expect(alone.code).toBe(1);
    expect(alone.err).toContain("commute-gangnam-yangjae down 17:00 (pilot): 4 stop times for a sequence of 3 stops");
    expect(against.code).toBe(0);
    expect(against.out).toContain(`next: apply the file to the same target at once: npm run schedule -- --file ${previous}`);
    expect((await store.readDataset(devDb(), "bus-stops"))?.revision).toBe(3);
  });

  it("names --create in the command when the file holds a pattern the target does not store, and says a dry run wrote nothing", async () => {
    // Arrange
    const raw = commuteTimetable();
    raw.patterns = raw.patterns.map((pattern: { patternId: string }) => ({ ...pattern, patternId: "winter" }));
    await seed(`${BUS_CAMPUS}_dev`, commuteTimetable());
    await store.create(devDb(), "bus-stops", busStopsFixture(), { by: OPERATOR, now: NOW });
    await data(["pull", "bus-stops"], { env: env() });
    const working = path.join(root, ".data", "dev", "bus-stops.json");
    const pulled = JSON.parse(fs.readFileSync(working, "utf8"));
    pulled.data.stops[0].detail = { ko: "파리바게뜨 앞" };
    fs.writeFileSync(working, JSON.stringify(pulled));
    const next = path.join(root, "winter.json");
    fs.writeFileSync(next, JSON.stringify(raw));

    // Act
    const dryRun = await data(["push", "bus-stops", "--against", next, "--dry-run"], { env: env() });
    const pushed = await data(["push", "bus-stops", "--against", next], { env: env() });

    // Assert
    expect(dryRun.code).toBe(0);
    expect(dryRun.out).toContain(`[dry run] a push would be followed at once by: npm run schedule -- --file ${next} --create`);
    expect(dryRun.out).not.toContain("next: apply");
    expect(pushed.out).toContain(`next: apply the file to the same target at once: npm run schedule -- --file ${next} --create`);
  });

  it("refuses --against outside a push, or for a dataset that reads no timetable, as a usage error", async () => {
    // Arrange
    const next = path.join(root, "commute-schedule.json");
    fs.writeFileSync(next, JSON.stringify(commuteTimetable()));

    // Act
    const check = await data(["check", "bus-stops", "--against", next], { env: env() });
    const other = await data(["push", "home-layout", "--against", next], { env: env() });

    // Assert
    expect([check.code, other.code]).toEqual([2, 2]);
    expect(check.err).toContain("--against goes with push");
    expect(other.err).toContain("home-layout reads no collection a timetable file replaces");
  });

  it("refuses a bus-stops push when MONGO_DB_NAME_BUS_CAMPUS is not set, and pushes another dataset without reading any timetable", async () => {
    // Arrange
    const file = stopsFile();
    const layout = path.join(root, "home-layout.json");
    fs.writeFileSync(layout, JSON.stringify(homeLayout));

    // Act
    const stops = await data(["push", "bus-stops", "--create", "--file", file]);
    const home = await data(["push", "home-layout", "--create", "--file", layout]);

    // Assert
    expect(stops.code).toBe(1);
    expect(stops.err).toContain("MONGO_DB_NAME_BUS_CAMPUS is not set in .env");
    expect(home.code).toBe(0);
    expect(home.out).not.toContain("bus_schedules");
  });
});
