/**
 * The subway timetables' round trip between their one writer and the store,
 * over a real `mongod` (move-reference-datasets tasks 10.1 and 10.2, designs
 * D4 and D5; ADR 0013, D3 and D6): what `npm run data` checks with the
 * catalog's `subway-timetables` entry and stores through
 * scripts/lib/datasets/parts.js is one header, whose manifest names one part
 * per table key, and one `dataset_parts` document per table, each read back
 * equal to the table pushed.
 *
 * The writer is the tool's own catalog, checks and parts modules, not a copy
 * of their document shapes, so a change to how the tool stores a parted
 * dataset that the reader does not follow fails here.
 */
import path from "node:path";
import type { Db as MongoDb } from "mongodb";
import type { Timetable } from "../../../src/subway/timetable/subway-timetable.types";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";
import { subwayTimetableFixtureFiles } from "../../helpers/subway/timetables";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const { checkParts } = require("../../../scripts/lib/datasets/checks");
const parts = require("../../../scripts/lib/datasets/parts");
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type CheckedPart = { key: string; data: Timetable; summary: unknown };
type ManifestEntry = { key: string; partId: string; summary: { source: unknown; trainCount: number } };

const SRC = path.join(__dirname, "../../../src");
const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";
const DATASET = "subway-timetables";

let mongod: TestMongod;
let db: Db;
let content: MongoDb;

/** The fixture's tables as the push checks them: parsed, keyed and summarized by the catalog entry. */
function checkedFixture(): CheckedPart[] {
  const catalog = loadCatalog((relativePath: string) => require(path.join(SRC, relativePath)));
  const files = subwayTimetableFixtureFiles().map(({ file, table }) => ({ file, data: table }));
  const checked = checkParts(catalog, DATASET, files, {}) as { issues: unknown[]; parts: CheckedPart[] };
  if (checked.issues.length > 0) throw new Error(`the fixture fails its push checks: ${JSON.stringify(checked.issues)}`);
  return checked.parts;
}

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  await clearCollections(content);
});

describe("the subway timetables stored by npm run data", () => {
  it("Revision 1: names 18 tables, one part per key, each read back equal to its table", async () => {
    // Arrange
    const checked = checkedFixture();

    // Act
    const result = await parts.create(content, DATASET, checked, { by: AUTHOR, now: NOW });

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 1 });
    const header = await store.readDataset(content, DATASET);
    const entries = header.data.parts as ManifestEntry[];
    expect(entries.map((entry) => entry.key)).toEqual(subwayTimetableFixtureFiles().map(({ file }) => file.replace(/\.json$/, "")).sort());
    expect(entries.every((entry) => new RegExp(`^subway-timetables/${entry.key}@[0-9a-f]{16}$`).test(entry.partId))).toBe(true);
    const tablesByKey = new Map(checked.map((part) => [part.key, part.data]));
    expect(entries.map((entry) => entry.summary)).toEqual(entries.map(({ key }) => ({ source: tablesByKey.get(key)?.source, trainCount: tablesByKey.get(key)?.trains.length })));
    const read = await parts.readParts(content, header.data);
    expect(read.missing).toEqual([]);
    expect(read.parts.map((part: { key: string; data: Timetable }) => [part.key, part.data])).toEqual(entries.map(({ key }) => [key, tablesByKey.get(key)]));
    expect(await content.collection("dataset_parts").countDocuments({ dataset: DATASET })).toBe(18);
  });

  it("One line rebuilt: revision 2 changing the three 2호선 tables names the same parts as revision 1 for the other 15", async () => {
    // Arrange
    const checked = checkedFixture();
    await parts.create(content, DATASET, checked, { by: AUTHOR, now: NOW });
    const rebuilt = checked.map((part) =>
      part.data.line === "2" ? { ...part, data: { ...part.data, source: { ...part.data.source, revision: "2026-11-01" } } } : part,
    );

    // Act
    const result = await parts.push(content, DATASET, rebuilt, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    const [first, second] = await Promise.all([store.readRevision(content, DATASET, 1), store.readRevision(content, DATASET, 2)]);
    const idsOf = (entries: ManifestEntry[]) => new Map(entries.map((entry) => [entry.key, entry.partId]));
    const [before, after] = [idsOf(first.entry.data.parts), idsOf(second.entry.data.parts)];
    const changed = [...after].filter(([key, partId]) => before.get(key) !== partId).map(([key]) => key);
    expect(changed).toEqual(["S1-2-holiday", "S1-2-saturday", "S1-2-weekday"]);
    expect(await content.collection("dataset_parts").countDocuments({ dataset: DATASET })).toBe(21);
  });
});
