/**
 * Parted datasets in `npm run data` (scripts/lib/datasets/parts.js, design D4
 * of openspec/changes/move-reference-datasets), over a real `mongod`:
 *
 *   - a parted dataset is its `datasets` header, whose data is a manifest
 *     naming each part by its key and a content-derived id, plus one
 *     `dataset_parts` document per part, stored once and never changed;
 *   - every part is written before the header, so a push that stops in
 *     between leaves the served revision unchanged and naming only parts that
 *     exist;
 *   - a part is deleted only when neither the current header nor a retained
 *     revision names it, and only an hour after it was saved.
 *
 * The command line (scripts/data.js, scripts/lib/datasets/working-dir.js) runs
 * over a two-part test catalog, `test-tables`: one part per line and day type,
 * and a coverage check that every line has a weekday table. A parted dataset
 * is pulled into a directory and pushed back from it, keyed by `keyOf`, with a
 * report of every part and the same safety rules as a single document.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "mongodb";
import { z } from "zod";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const parts = require("../../../scripts/lib/datasets/parts");
const store = require("../../../scripts/lib/datasets/store");
const { run } = require("../../../scripts/data");

type DbModule = typeof import("../../../src/infra/db");

interface Table {
  line: string;
  dayType: string;
  trains: string[];
}

interface ManifestEntry {
  key: string;
  partId: string;
  summary: unknown;
}

const NOW = new Date("2026-10-19T03:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const ALICE = "alice@example.com";
const DATASET = "test-tables";

const table = (line: string, dayType: string, trains: string[]): Table => ({ line, dayType, trains });
const partOf = (t: Table) => ({ key: `${t.line}-${t.dayType}`, data: t, summary: { trainCount: t.trains.length } });

/** JSON with every object's keys sorted, the form a part's hash is taken over. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256Of = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const partIdOf = (t: Table): string => `${DATASET}/${t.line}-${t.dayType}@${sha256Of(t).slice(0, 16)}`;

const weekday1 = table("1", "weekday", ["05:30", "05:40"]);
const weekday2 = table("2", "weekday", ["05:31"]);

const LINES = ["1", "2"];
const SENTINEL = "Sentinel-Pa55word-9d1e";
const USER = "partstool";
const BASE = "parts_content";
const DEV = "parts_content_dev";

/** A parted dataset: one table per line and day type, every line with a weekday table. */
const tablesCatalog = {
  sources: {},
  datasets: {
    [DATASET]: {
      owner: "src/test-tables",
      parts: {
        schema: z.strictObject({ line: z.string(), dayType: z.enum(["weekday", "holiday"]), trains: z.array(z.string().regex(/^\d\d:\d\d$/)) }),
        keyOf: (t: Table) => `${t.line}-${t.dayType}`,
        summaryOf: (t: Table) => ({ trainCount: t.trains.length }),
      },
      issuesOf: (tables: Table[]) =>
        LINES.filter((line) => !tables.some((t) => t.line === line && t.dayType === "weekday")).map((line) => ({ path: [line], message: `line ${line} has no weekday table` })),
      referencesOf: () => [],
    },
  },
};

let mongod: TestMongod;
let dbModule: DbModule;
let db: Db;
let mongoUrl: string;
let root: string;

beforeAll(async () => {
  mongod = await startMongod();
  dbModule = require("../../../src/infra/db") as DbModule;
  assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
  db = dbModule.getClient().db("data_tool_parts_dev");
  // WHY: a password the tool must never print; a mongod without --auth still checks credentials it is sent.
  await dbModule.getClient().db("admin").command({ createUser: USER, pwd: SENTINEL, roles: ["root"] });
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
  await db.dropDatabase();
  await devDb().dropDatabase();
  await prodDb().dropDatabase();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "data-tool-parts-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const devDb = (): Db => dbModule.getClient().db(DEV);
const prodDb = (): Db => dbModule.getClient().db(BASE);

const storedParts = (dataset = DATASET) => db.collection("dataset_parts").find({ dataset }).sort({ _id: 1 }).toArray();
const manifestOf = async (): Promise<ManifestEntry[]> => (await store.readDataset(db, DATASET)).data.parts;

/** A Db whose `datasets` writes throw, as a process that dies after the parts and before the header. */
function crashingAtHeader(real: Db): Db {
  const crash = () => Promise.reject(new Error("process killed"));
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property !== "collection") return Reflect.get(target, property, receiver);
      return (name: string) => {
        const collection = target.collection(name);
        if (name !== "datasets") return collection;
        return new Proxy(collection, {
          get: (c, p, r) => (p === "updateOne" || p === "insertOne" ? crash : Reflect.get(c, p, r)),
        });
      };
    },
  });
}

describe("parts.create and parts.push", () => {
  it("stores each part under `<dataset>/<key>@<sha256 prefix>` and a header manifest ordered by key", async () => {
    // Act
    const result = await parts.create(db, DATASET, [partOf(weekday2), partOf(weekday1)], { by: ALICE, now: NOW, note: "import" });

    // Assert
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(await storedParts()).toEqual([
      { _id: partIdOf(weekday1), dataset: DATASET, key: "1-weekday", sha256: sha256Of(weekday1), data: weekday1, savedAt: NOW, savedBy: ALICE },
      { _id: partIdOf(weekday2), dataset: DATASET, key: "2-weekday", sha256: sha256Of(weekday2), data: weekday2, savedAt: NOW, savedBy: ALICE },
    ]);
    expect(await store.readDataset(db, DATASET)).toMatchObject({
      revision: 1,
      data: {
        parts: [
          { key: "1-weekday", partId: partIdOf(weekday1), summary: { trainCount: 2 } },
          { key: "2-weekday", partId: partIdOf(weekday2), summary: { trainCount: 1 } },
        ],
      },
    });
  });

  it("stores an identical part once across revisions, both manifests naming it", async () => {
    // Arrange
    await parts.create(db, DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    const changed = table("2", "weekday", ["05:31", "05:50"]);

    // Act
    const result = await parts.push(db, DATASET, [partOf(weekday1), partOf(changed)], { baseRevision: 1, by: ALICE, now: NOW });

    // Assert
    expect(result).toEqual({ ok: true, revision: 2 });
    expect((await storedParts()).map((part) => part._id)).toEqual([partIdOf(weekday1), partIdOf(weekday2), partIdOf(changed)].sort());
    const [first, second] = (await store.history(db, DATASET)).reverse();
    expect(first.data.parts[0].partId).toBe(partIdOf(weekday1));
    expect(second.data.parts[0].partId).toBe(partIdOf(weekday1));
  });

  it("stops at an existing id whose full hash differs, overwriting nothing and writing no header", async () => {
    // Arrange
    await parts.create(db, DATASET, [partOf(weekday1)], { by: ALICE, now: NOW });
    const impostor = { _id: partIdOf(weekday2), dataset: DATASET, key: "2-weekday", sha256: "f".repeat(64), data: { other: true }, savedAt: NOW, savedBy: ALICE };
    await db.collection("dataset_parts").insertOne(impostor as never);

    // Act
    const result = await parts.push(db, DATASET, [partOf(weekday1), partOf(weekday2)], { baseRevision: 1, by: ALICE, now: NOW });

    // Assert
    expect(result).toEqual({ ok: false, reason: "collision", partId: partIdOf(weekday2) });
    expect(await db.collection("dataset_parts").findOne({ _id: partIdOf(weekday2) as never })).toEqual(impostor);
    expect(await store.readDataset(db, DATASET)).toMatchObject({ revision: 1 });
    expect(await store.history(db, DATASET)).toHaveLength(1);
  });

  it("leaves the served revision unchanged, naming only stored parts, when the run dies after the parts", async () => {
    // Arrange
    await parts.create(db, DATASET, [partOf(weekday1)], { by: ALICE, now: NOW });
    const changed = table("1", "weekday", ["06:00"]);

    // Act
    const pushed = parts.push(crashingAtHeader(db), DATASET, [partOf(changed), partOf(weekday2)], { baseRevision: 1, by: ALICE, now: NOW });

    // Assert
    await expect(pushed).rejects.toThrow("process killed");
    expect(await store.readDataset(db, DATASET)).toMatchObject({ revision: 1 });
    const named = (await manifestOf()).map((entry) => entry.partId);
    const ids = (await storedParts()).map((part) => part._id);
    expect(named).toEqual([partIdOf(weekday1)]);
    expect(ids).toEqual(expect.arrayContaining([...named, partIdOf(changed), partIdOf(weekday2)]));
  });

  it("creates the { dataset: 1 } index on dataset_parts", async () => {
    // Act
    await parts.create(db, DATASET, [partOf(weekday1)], { by: ALICE, now: NOW });

    // Assert
    const keys = (await db.collection("dataset_parts").indexes()).map((index) => index.key);
    expect(keys).toContainEqual({ dataset: 1 });
  });
});

describe("parts garbage collection", () => {
  it("deletes a pruned revision's part once no retained revision names it, and keeps every part a retained one names", async () => {
    // Arrange
    // Revision 1 names weekday2; revisions 2 to 51 each name their own line-2 table, and all name weekday1.
    await parts.create(db, DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    const later = new Date(NOW.getTime() + 2 * HOUR_MS);
    for (let revision = 2; revision <= 50; revision++) {
      await parts.push(db, DATASET, [partOf(weekday1), partOf(table("2", "weekday", [`r${revision}`]))], { baseRevision: revision - 1, by: ALICE, now: later });
    }
    const keptBefore51 = (await storedParts()).map((part) => part._id);

    // Act
    await parts.push(db, DATASET, [partOf(weekday1), partOf(table("2", "weekday", ["r51"]))], { baseRevision: 50, by: ALICE, now: later });

    // Assert
    expect(keptBefore51).toContain(partIdOf(weekday2));
    const ids = (await storedParts()).map((part) => part._id);
    expect(ids).not.toContain(partIdOf(weekday2));
    const retained = await store.history(db, DATASET);
    expect(retained).toHaveLength(50);
    const named = new Set(retained.flatMap((entry: { data: { parts: ManifestEntry[] } }) => entry.data.parts.map((part) => part.partId)));
    expect(ids.sort()).toEqual([...named].sort());
  });

  it("keeps an unnamed part younger than one hour and a part of another dataset", async () => {
    // Arrange
    await parts.create(db, DATASET, [partOf(weekday1)], { by: ALICE, now: NOW });
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60 * 1000);
    const orphan = (id: string, dataset: string, savedAt: Date) => ({ _id: id, dataset, key: "x", sha256: "0".repeat(64), data: {}, savedAt, savedBy: ALICE });
    await db.collection("dataset_parts").insertMany([
      orphan(`${DATASET}/x@young`, DATASET, at(100)),
      orphan(`${DATASET}/x@old`, DATASET, at(0)),
      orphan("other/x@old", "other", at(0)),
    ] as never[]);

    // Act
    await parts.push(db, DATASET, [partOf(table("1", "weekday", ["07:00"]))], { baseRevision: 1, by: ALICE, now: at(120) });

    // Assert
    const ids = (await db.collection("dataset_parts").find({}).toArray()).map((part) => part._id);
    expect(ids).toEqual(expect.arrayContaining([`${DATASET}/x@young`, "other/x@old", partIdOf(weekday1)]));
    expect(ids).not.toContain(`${DATASET}/x@old`);
  });

  it("never deletes a part the current header names, even when its history entry is missing", async () => {
    // Arrange
    await parts.create(db, DATASET, [partOf(weekday1)], { by: ALICE, now: NOW });
    await db.collection("dataset_revisions").deleteOne({ _id: `${DATASET}@1` as never });

    // Act
    const result = await parts.collectGarbage(db, DATASET, { now: new Date(NOW.getTime() + 3 * HOUR_MS) });

    // Assert
    expect(result).toEqual({ deleted: 0 });
    expect((await storedParts()).map((part) => part._id)).toEqual([partIdOf(weekday1)]);
  });
});

interface Ran {
  code: number;
  out: string;
  err: string;
}

/** Runs the tool as `npm run data -- <argv>` would, over the test catalog and the test mongod. */
async function data(argv: string[], options: { isTTY?: boolean; answer?: string } = {}): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: { MONGO_URL: mongoUrl, MONGO_CONTENT_DB_NAME: BASE },
    root,
    catalog: tablesCatalog,
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
    isTTY: options.isTTY ?? false,
    ask: async () => options.answer ?? "",
    now: () => NOW,
    whoami: () => ALICE,
    serverSelectionTimeoutMS: 1_000,
  });
  return { code, out: out.join(""), err: err.join("") };
}

const holiday1 = table("1", "holiday", ["06:00"]);
const workingDir = (target: "dev" | "prod") => path.join(root, ".data", target, DATASET);
const partFile = (target: "dev" | "prod", name: string) => path.join(workingDir(target), "parts", name);
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const revisionIn = async (target: Db): Promise<number | null> => (await store.readDataset(target, DATASET))?.revision ?? null;
const partCountIn = (target: Db) => target.collection("dataset_parts").countDocuments({ dataset: DATASET });

describe("npm run data, a parted dataset", () => {
  it("pull writes the working file and one file per part under .data/<target>/<dataset>/", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });

    // Act
    const result = await data(["pull", DATASET]);

    // Assert
    expect(result.code).toBe(0);
    expect(readJson(path.join(workingDir("dev"), "working.json"))).toEqual({
      dataset: DATASET,
      target: "dev",
      baseRevision: 1,
      pulledAt: NOW.toISOString(),
      manifest: (await store.readDataset(devDb(), DATASET)).data,
    });
    expect(fs.readdirSync(path.join(workingDir("dev"), "parts")).sort()).toEqual(["1-weekday.json", "2-weekday.json"]);
    expect(readJson(partFile("dev", "1-weekday.json"))).toEqual(weekday1);
  });

  it("push keys each part by keyOf, reports every key, and stores the next revision", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2), partOf(holiday1)], { by: ALICE, now: NOW });
    await data(["pull", DATASET]);
    fs.renameSync(partFile("dev", "1-weekday.json"), partFile("dev", "renamed.json"));
    writeJson(partFile("dev", "2-weekday.json"), table("2", "weekday", ["05:31", "05:45"]));
    fs.rmSync(partFile("dev", "1-holiday.json"));
    writeJson(partFile("dev", "new.json"), table("2", "holiday", ["07:00"]));

    // Act
    const result = await data(["push", DATASET, "--note", "line 2 update"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/unchanged\s+1-weekday/);
    expect(result.out).toMatch(/changed\s+2-weekday\s.*trainCount: 1 -> 2/);
    expect(result.out).toMatch(/added\s+2-holiday/);
    expect(result.out).toMatch(/removed\s+1-holiday/);
    const header = await store.readDataset(devDb(), DATASET);
    expect(header.revision).toBe(2);
    expect(header.data.parts.map((entry: ManifestEntry) => entry.key)).toEqual(["1-weekday", "2-holiday", "2-weekday"]);
    expect(header.data.parts[0].partId).toBe(partIdOf(weekday1));
    expect(readJson(path.join(workingDir("dev"), "working.json"))).toMatchObject({ baseRevision: 2, manifest: header.data });
  });

  it("refuses two files with the same key, naming both, and writes nothing", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await data(["pull", DATASET]);
    writeJson(partFile("dev", "copy.json"), table("1", "weekday", ["09:00"]));

    // Act
    const result = await data(["push", DATASET]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("1-weekday");
    expect(result.err).toContain("copy.json");
    expect(result.err).toContain("1-weekday.json");
    expect(await revisionIn(devDb())).toBe(1);
    expect(await partCountIn(devDb())).toBe(2);
  });

  it("refuses a part the part schema rejects and a set the dataset's checks reject, naming each, and writes nothing", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await data(["pull", DATASET]);
    writeJson(partFile("dev", "1-weekday.json"), table("1", "weekday", ["5:30"]));
    fs.rmSync(partFile("dev", "2-weekday.json"));
    const schemaRun = await data(["push", DATASET]);
    writeJson(partFile("dev", "1-weekday.json"), weekday1);

    // Act
    const coverageRun = await data(["push", DATASET]);

    // Assert
    expect(schemaRun.code).toBe(1);
    expect(schemaRun.err).toContain("1-weekday.json.trains.0");
    expect(coverageRun.code).toBe(1);
    expect(coverageRun.err).toContain("line 2 has no weekday table");
    expect(await revisionIn(devDb())).toBe(1);
    expect(await partCountIn(devDb())).toBe(2);
  });

  it("reports no change for an unedited directory and writes nothing", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await data(["pull", DATASET]);

    // Act
    const result = await data(["push", DATASET]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/no change/i);
    expect(await revisionIn(devDb())).toBe(1);
    expect(await store.history(devDb(), DATASET)).toHaveLength(1);
  });

  it("refuses a push from a stale pull, naming the current revision", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await data(["pull", DATASET]);
    await parts.push(devDb(), DATASET, [partOf(weekday1), partOf(weekday2), partOf(holiday1)], { baseRevision: 1, by: "bob@example.com", now: NOW });
    writeJson(partFile("dev", "2-weekday.json"), table("2", "weekday", ["05:59"]));

    // Act
    const result = await data(["push", DATASET]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("revision 2");
    expect(result.err).toContain("bob@example.com");
    expect(await revisionIn(devDb())).toBe(2);
  });

  it("refuses a directory pulled from _dev with --prod, and writes nothing", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await parts.create(prodDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await data(["pull", DATASET]);
    writeJson(partFile("dev", "2-weekday.json"), table("2", "weekday", ["05:59"]));

    // Act
    const result = await data(["push", DATASET, "--prod", "--yes", "--dir", workingDir("dev")]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/pulled from the development database/);
    expect(await revisionIn(prodDb())).toBe(1);
    expect(await partCountIn(prodDb())).toBe(2);
  });

  it("writes no part and no header to production without --yes on a non-TTY, or with --dry-run", async () => {
    // Arrange
    await parts.create(prodDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await data(["pull", DATASET, "--prod"]);
    writeJson(partFile("prod", "2-weekday.json"), table("2", "weekday", ["05:59"]));

    // Act
    const unconfirmed = await data(["push", DATASET, "--prod"]);
    const dryRun = await data(["push", DATASET, "--prod", "--yes", "--dry-run"]);

    // Assert
    expect(unconfirmed.code).toBe(1);
    expect(unconfirmed.err).toContain("--yes");
    expect(dryRun.code).toBe(0);
    expect(dryRun.out).toMatch(/changed\s+2-weekday/);
    expect(await revisionIn(prodDb())).toBe(1);
    expect(await partCountIn(prodDb())).toBe(2);
  });

  it("push --create --dir stores revision 1 from a plain directory of part files", async () => {
    // Arrange
    const dir = path.join(root, "tables");
    fs.mkdirSync(dir);
    writeJson(path.join(dir, "a.json"), weekday2);
    writeJson(path.join(dir, "b.json"), weekday1);

    // Act
    const result = await data(["push", DATASET, "--create", "--dir", dir, "--note", "import"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/added\s+1-weekday/);
    expect(result.out).toMatch(/added\s+2-weekday/);
    expect(await store.readDataset(devDb(), DATASET)).toMatchObject({
      revision: 1,
      data: { parts: [{ key: "1-weekday", partId: partIdOf(weekday1) }, { key: "2-weekday", partId: partIdOf(weekday2) }] },
    });
    expect(await revisionIn(prodDb())).toBeNull();
  });

  it("never prints MONGO_URL or any part of it", async () => {
    // Arrange
    const dir = path.join(root, "tables");
    fs.mkdirSync(dir);
    writeJson(path.join(dir, "1-weekday.json"), weekday1);
    writeJson(path.join(dir, "2-weekday.json"), weekday2);

    // Act
    const runs = [await data(["push", DATASET, "--create", "--dir", dir]), await data(["pull", DATASET]), await data(["push", DATASET])];

    // Assert
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0]);
    for (const { out, err } of runs) {
      expect(out + err).not.toContain(SENTINEL);
      expect(out + err).not.toContain(USER);
      expect(out + err).not.toContain(mongod.uri.replace("mongodb://", "").replace(/\/$/, ""));
    }
  });
});

describe("npm run data, a parted dataset's history", () => {
  const changed2 = table("2", "weekday", ["05:31", "05:50"]);

  it("rollback stores the earlier revision's manifest as a new revision, every part it names still stored", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await parts.push(devDb(), DATASET, [partOf(weekday1), partOf(changed2)], { baseRevision: 1, by: ALICE, now: NOW });
    const revision1 = (await store.readRevision(devDb(), DATASET, 1)).entry.data;

    // Act
    const result = await data(["rollback", DATASET, "1"]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/changed\s+2-weekday/);
    const header = await store.readDataset(devDb(), DATASET);
    expect(header).toMatchObject({ revision: 3, data: revision1 });
    const found = await parts.readParts(devDb(), header.data);
    expect(found.missing).toEqual([]);
    expect(found.parts.map((part: { data: Table }) => part.data)).toEqual([weekday1, weekday2]);
  });

  it("rollback refuses a revision that names a part no longer stored, naming it, and writes nothing", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await parts.push(devDb(), DATASET, [partOf(weekday1), partOf(changed2)], { baseRevision: 1, by: ALICE, now: NOW });
    await devDb().collection("dataset_parts").deleteOne({ _id: partIdOf(weekday2) as never });

    // Act
    const viaTool = await data(["rollback", DATASET, "1"]);
    const viaStore = await parts.rollback(devDb(), DATASET, 1, { baseRevision: 2, by: ALICE, now: NOW });

    // Assert
    expect(viaTool.code).toBe(1);
    expect(viaTool.err).toContain(partIdOf(weekday2));
    expect(viaStore).toEqual({ ok: false, reason: "missing-parts", partIds: [partIdOf(weekday2)] });
    expect(await revisionIn(devDb())).toBe(2);
  });

  it("copy-prod-to-dev copies the parts production's revision names, then the header", async () => {
    // Arrange
    await parts.create(prodDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });

    // Act
    const result = await data(["copy-prod-to-dev", DATASET]);

    // Assert
    expect(result.code).toBe(0);
    const header = await store.readDataset(devDb(), DATASET);
    expect(header).toMatchObject({ revision: 1, data: (await store.readDataset(prodDb(), DATASET)).data });
    expect((await store.history(devDb(), DATASET))[0]).toMatchObject({ copiedFrom: { database: BASE, revision: 1 } });
    const found = await parts.readParts(devDb(), header.data);
    expect(found.missing).toEqual([]);
    expect(found.parts.map((part: { data: Table }) => part.data)).toEqual([weekday1, weekday2]);
  });

  it("copy-prod-to-dev writes no header when a part cannot be copied", async () => {
    // Arrange
    await parts.create(prodDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    const impostor = { _id: partIdOf(weekday2), dataset: DATASET, key: "2-weekday", sha256: "f".repeat(64), data: {}, savedAt: NOW, savedBy: ALICE };
    await devDb().collection("dataset_parts").insertOne(impostor as never);

    // Act
    const result = await data(["copy-prod-to-dev", DATASET]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(partIdOf(weekday2));
    expect(await revisionIn(devDb())).toBeNull();
    expect(await devDb().collection("dataset_parts").findOne({ _id: partIdOf(weekday2) as never })).toEqual(impostor);
  });

  it("check reads every part the header names and runs the push checks on them", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await parts.create(prodDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    const passing = await data(["check", DATASET]);
    await devDb().collection("dataset_parts").updateOne({ _id: partIdOf(weekday1) as never }, { $set: { "data.trains": ["5:30"] } });
    await devDb().collection("dataset_parts").deleteOne({ _id: partIdOf(weekday2) as never });
    const broken = { parts: [(await store.readDataset(prodDb(), DATASET)).data.parts[0]] };
    await prodDb().collection("datasets").updateOne({ _id: DATASET as never }, { $set: { data: broken } });

    // Act
    const failing = await data(["check", DATASET]);
    const uncovered = await data(["check", DATASET, "--prod"]);

    // Assert
    expect(passing.code).toBe(0);
    expect(failing.code).toBe(1);
    expect(failing.err).toContain("1-weekday.trains.0");
    expect(failing.err).toContain(partIdOf(weekday2));
    expect(uncovered.code).toBe(1);
    expect(uncovered.err).toContain("line 2 has no weekday table");
  });

  it("records a missing history entry from the header", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await parts.push(devDb(), DATASET, [partOf(weekday1), partOf(changed2)], { baseRevision: 1, by: ALICE, now: NOW });
    await devDb().collection("dataset_revisions").deleteOne({ _id: `${DATASET}@2` as never });

    // Act
    const result = await data(["history", DATASET]);

    // Assert
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/repaired: test-tables revision 2/);
    expect((await store.readRevision(devDb(), DATASET, 2)).entry).toMatchObject({ data: (await store.readDataset(devDb(), DATASET)).data });
  });

  it("history prints each revision's per-part summary", async () => {
    // Arrange
    await parts.create(devDb(), DATASET, [partOf(weekday1), partOf(weekday2)], { by: ALICE, now: NOW });
    await parts.push(devDb(), DATASET, [partOf(weekday1), partOf(changed2)], { baseRevision: 1, by: ALICE, now: NOW });

    // Act
    const result = await data(["history", DATASET]);

    // Assert
    expect(result.code).toBe(0);
    const [second, first] = result.out.split(/^\s*\d+\s+\d{4}-\d{2}-\d{2}T.*$/m).slice(1);
    expect(second).toMatch(/2-weekday\s+\{"trainCount":2\}/);
    expect(first).toMatch(/2-weekday\s+\{"trainCount":1\}/);
    expect(first).toMatch(/1-weekday\s+\{"trainCount":2\}/);
  });
});
