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
 */
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const parts = require("../../../scripts/lib/datasets/parts");
const store = require("../../../scripts/lib/datasets/store");

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

let mongod: TestMongod;
let dbModule: DbModule;
let db: Db;

beforeAll(async () => {
  mongod = await startMongod();
  dbModule = require("../../../src/infra/db") as DbModule;
  assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
  db = dbModule.getClient().db("data_tool_parts_dev");
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
});

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
