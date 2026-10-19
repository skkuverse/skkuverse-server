/**
 * The MongoDB protocol of `npm run data` (scripts/lib/datasets/store.js,
 * design D4 and D5 of openspec/changes/move-runtime-data-to-db), over a real
 * `mongod`:
 *
 *   - a dataset is one `datasets` document whose revision only moves forward
 *     from the revision an edit was based on, so a stale edit writes nothing;
 *   - every stored version has a `dataset_revisions` entry, written by the
 *     winner after the dataset with no transaction, and repaired on the next
 *     run when a writer died in between;
 *   - the newest 50 revisions are kept, never pruning the current one;
 *   - a rollback and a copy from production are new revisions, never a rewrite.
 */
import type { Db } from "mongodb";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type DbModule = typeof import("../../../src/infra/db");

const NOW = new Date("2026-10-19T03:00:00.000Z");
const LATER = new Date("2026-10-19T04:00:00.000Z");
const ALICE = "alice@example.com";
const BOB = "bob@example.com";

const layout = (title: string) => ({ version: 1, sections: [{ type: "tile_grid", id: "t", title: { ko: title } }] });

let mongod: TestMongod;
let dbModule: DbModule;
let dev: Db;
let prod: Db;

beforeAll(async () => {
  mongod = await startMongod();
  dbModule = require("../../../src/infra/db") as DbModule;
  assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
  dev = dbModule.getClient().db("data_tool_store_dev");
  prod = dbModule.getClient().db("data_tool_store");
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await dbModule?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  await clearCollections(dev);
  await clearCollections(prod);
});

const revisionsOf = (db: Db, dataset: string) =>
  db.collection("dataset_revisions").find({ dataset }).sort({ revision: 1 }).toArray();

/** Stores revisions 1..`last` of `dataset`, each a distinct title. */
async function storeRevisions(db: Db, dataset: string, last: number): Promise<void> {
  await store.create(db, dataset, layout("r1"), { by: ALICE, now: NOW });
  for (let revision = 2; revision <= last; revision++) {
    await store.push(db, dataset, layout(`r${revision}`), { baseRevision: revision - 1, by: ALICE, now: NOW });
  }
}

describe("store.create", () => {
  it("stores revision 1 with its data, time, author and history entry", async () => {
    // Act
    const result = await store.create(dev, "home-layout", layout("a"), { by: ALICE, now: NOW, note: "import" });

    // Assert
    expect(result).toEqual({ ok: true, revision: 1 });
    expect(await dev.collection("datasets").findOne({ _id: "home-layout" as never })).toEqual({
      _id: "home-layout",
      revision: 1,
      data: layout("a"),
      updatedAt: NOW,
      updatedBy: ALICE,
    });
    expect(await revisionsOf(dev, "home-layout")).toEqual([
      {
        _id: "home-layout@1",
        dataset: "home-layout",
        revision: 1,
        data: layout("a"),
        savedAt: NOW,
        savedBy: ALICE,
        command: "create",
        note: "import",
      },
    ]);
  });

  it("refuses an existing dataset, writing nothing and reporting its revision", async () => {
    // Arrange
    await store.create(dev, "home-layout", layout("a"), { by: ALICE, now: NOW });

    // Act
    const result = await store.create(dev, "home-layout", layout("b"), { by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: false, reason: "exists", current: { revision: 1, updatedBy: ALICE, updatedAt: NOW } });
    expect((await store.readDataset(dev, "home-layout")).data).toEqual(layout("a"));
    expect(await revisionsOf(dev, "home-layout")).toHaveLength(1);
  });
});

describe("store.push", () => {
  it("stores the next revision from the current base, with its history entry", async () => {
    // Arrange
    await store.create(dev, "home-layout", layout("a"), { by: ALICE, now: NOW });

    // Act
    const result = await store.push(dev, "home-layout", layout("b"), { baseRevision: 1, by: BOB, now: LATER, note: "retitle" });

    // Assert
    expect(result).toEqual({ ok: true, revision: 2 });
    expect(await store.readDataset(dev, "home-layout")).toEqual({
      _id: "home-layout",
      revision: 2,
      data: layout("b"),
      updatedAt: LATER,
      updatedBy: BOB,
    });
    expect((await revisionsOf(dev, "home-layout")).map((entry) => [entry.revision, entry.command, entry.savedBy, entry.note])).toEqual([
      [1, "create", ALICE, undefined],
      [2, "push", BOB, "retitle"],
    ]);
  });

  it("writes nothing from a stale base and reports the current revision, author and time", async () => {
    // Arrange
    await store.create(dev, "home-layout", layout("a"), { by: ALICE, now: NOW });
    await store.push(dev, "home-layout", layout("b"), { baseRevision: 1, by: BOB, now: LATER });

    // Act
    const result = await store.push(dev, "home-layout", layout("c"), { baseRevision: 1, by: ALICE, now: LATER });

    // Assert
    expect(result).toEqual({ ok: false, reason: "conflict", current: { revision: 2, updatedBy: BOB, updatedAt: LATER } });
    expect((await store.readDataset(dev, "home-layout")).data).toEqual(layout("b"));
    expect(await revisionsOf(dev, "home-layout")).toHaveLength(2);
  });

  it("refuses a dataset that does not exist yet", async () => {
    // Act
    const result = await store.push(dev, "home-layout", layout("a"), { baseRevision: 1, by: ALICE, now: NOW });

    // Assert
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(await store.readDataset(dev, "home-layout")).toBeNull();
  });

  it("keeps the newest 50 revisions: the 51st prunes revision 1 and keeps the current one", async () => {
    // Act
    await storeRevisions(dev, "home-layout", 51);

    // Assert
    const kept = (await revisionsOf(dev, "home-layout")).map((entry) => entry.revision);
    expect(kept).toEqual(Array.from({ length: 50 }, (_, i) => i + 2));
    expect((await store.readDataset(dev, "home-layout")).revision).toBe(51);
  });

  it("keeps all 50 revisions at the 50th", async () => {
    // Act
    await storeRevisions(dev, "home-layout", 50);

    // Assert
    expect((await revisionsOf(dev, "home-layout")).map((entry) => entry.revision)[0]).toBe(1);
  });

  it("prunes only the dataset it wrote", async () => {
    // Arrange
    await store.create(dev, "other", layout("o"), { by: ALICE, now: NOW });

    // Act
    await storeRevisions(dev, "home-layout", 51);

    // Assert
    expect(await revisionsOf(dev, "other")).toHaveLength(1);
  });
});

describe("store.repair", () => {
  it("records a missing entry for the current revision from the dataset, and reports it", async () => {
    // Arrange
    await store.create(dev, "home-layout", layout("a"), { by: ALICE, now: NOW });
    await store.push(dev, "home-layout", layout("b"), { baseRevision: 1, by: BOB, now: LATER });
    await dev.collection("dataset_revisions").deleteOne({ _id: "home-layout@2" as never });

    // Act
    const result = await store.repair(dev, "home-layout");

    // Assert
    expect(result).toEqual({ repaired: true, revision: 2 });
    expect(await dev.collection("dataset_revisions").findOne({ _id: "home-layout@2" as never })).toEqual({
      _id: "home-layout@2",
      dataset: "home-layout",
      revision: 2,
      data: layout("b"),
      savedAt: LATER,
      savedBy: BOB,
      command: "push",
      note: "recorded by repair",
    });
  });

  it("writes nothing when the current revision has its entry, or there is no dataset", async () => {
    // Arrange
    await store.create(dev, "home-layout", layout("a"), { by: ALICE, now: NOW });

    // Act
    const present = await store.repair(dev, "home-layout");
    const absent = await store.repair(dev, "no-such-dataset");

    // Assert
    expect(present).toEqual({ repaired: false });
    expect(absent).toEqual({ repaired: false });
    expect(await revisionsOf(dev, "home-layout")).toHaveLength(1);
  });
});

describe("store.rollback", () => {
  it("stores the earlier revision's data as a new revision marked rolledBackTo", async () => {
    // Arrange
    await storeRevisions(dev, "home-layout", 3);

    // Act
    const result = await store.rollback(dev, "home-layout", 1, { baseRevision: 3, by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: true, revision: 4 });
    expect((await store.readDataset(dev, "home-layout")).data).toEqual(layout("r1"));
    const entries = await revisionsOf(dev, "home-layout");
    expect(entries.map((entry) => entry.revision)).toEqual([1, 2, 3, 4]);
    expect(entries[3]).toMatchObject({ command: "rollback", rolledBackTo: 1, data: layout("r1"), savedBy: BOB });
  });

  it("refuses a pruned revision, naming the oldest kept, and writes nothing", async () => {
    // Arrange
    await storeRevisions(dev, "home-layout", 51);

    // Act
    const result = await store.rollback(dev, "home-layout", 1, { baseRevision: 51, by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pruned", oldestKept: 2 });
    expect((await store.readDataset(dev, "home-layout")).revision).toBe(51);
  });

  it("refuses a revision that was never stored", async () => {
    // Arrange
    await storeRevisions(dev, "home-layout", 2);

    // Act
    const result = await store.rollback(dev, "home-layout", 7, { baseRevision: 2, by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: false, reason: "no-revision" });
    expect((await store.readDataset(dev, "home-layout")).revision).toBe(2);
  });

  it("writes nothing when the dataset moved past its base", async () => {
    // Arrange
    await storeRevisions(dev, "home-layout", 3);

    // Act
    const result = await store.rollback(dev, "home-layout", 1, { baseRevision: 2, by: BOB, now: LATER });

    // Assert
    expect(result).toMatchObject({ ok: false, reason: "conflict", current: { revision: 3 } });
    expect((await store.readDataset(dev, "home-layout")).data).toEqual(layout("r3"));
  });
});

describe("store.copy", () => {
  it("stores production's data as the next development revision, recording copiedFrom", async () => {
    // Arrange
    await storeRevisions(prod, "home-layout", 12);
    await storeRevisions(dev, "home-layout", 3);

    // Act
    const result = await store.copy(prod, dev, "home-layout", { baseRevision: 3, by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: true, revision: 4 });
    expect((await store.readDataset(dev, "home-layout")).data).toEqual(layout("r12"));
    const entry = (await revisionsOf(dev, "home-layout"))[3];
    expect(entry).toMatchObject({
      revision: 4,
      command: "copy-prod-to-dev",
      copiedFrom: { database: "data_tool_store", revision: 12 },
    });
    expect((await store.readDataset(prod, "home-layout")).revision).toBe(12);
  });

  it("creates the development dataset when it has none", async () => {
    // Arrange
    await storeRevisions(prod, "home-layout", 2);

    // Act
    const result = await store.copy(prod, dev, "home-layout", { baseRevision: null, by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: true, revision: 1 });
    expect((await revisionsOf(dev, "home-layout"))[0]).toMatchObject({
      command: "copy-prod-to-dev",
      copiedFrom: { database: "data_tool_store", revision: 2 },
    });
  });

  it("refuses when production has no such dataset", async () => {
    // Act
    const result = await store.copy(prod, dev, "home-layout", { baseRevision: null, by: BOB, now: LATER });

    // Assert
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(await store.readDataset(dev, "home-layout")).toBeNull();
  });
});

describe("store.history", () => {
  it("lists revisions newest first", async () => {
    // Arrange
    await storeRevisions(dev, "home-layout", 3);

    // Act
    const entries = await store.history(dev, "home-layout");

    // Assert
    expect(entries.map((entry: { revision: number }) => entry.revision)).toEqual([3, 2, 1]);
  });
});
