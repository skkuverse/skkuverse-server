/**
 * What `npm run data` refuses before a write, and what `check` reports on
 * stored data (scripts/lib/datasets/checks.js, design D6 of
 * openspec/changes/move-runtime-data-to-db). Four checks, every issue
 * collected with its dataset and path:
 *
 *   1. the dataset's schema;
 *   2. its `issuesOf`, the checks a schema cannot hold;
 *   3. outgoing references: every identity it names resolves, in a stored
 *      dataset's `idsOf` or a code-held source;
 *   4. incoming references: every stored dataset that names this one still
 *      resolves against the data being pushed.
 *
 * No dataset of this stage declares `idsOf`, so the incoming check runs on a
 * two-dataset catalog built here. `check` reads stored data over a real
 * `mongod` and must write nothing.
 */
import path from "node:path";
import type { Db } from "mongodb";
import { z } from "zod";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { checkData, checkStored } = require("../../../scripts/lib/datasets/checks");
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const store = require("../../../scripts/lib/datasets/store");

type DbModule = typeof import("../../../src/infra/db");

const SRC = path.join(__dirname, "../../../src");
const srcLoader = (relativePath: string): unknown => require(path.join(SRC, relativePath));

const fixture = require("../ui/fixtures/home-layout.dataset.json") as Record<string, unknown>;
const { _about, ...homeLayout } = fixture;
void _about;

const NOW = new Date("2026-10-19T03:00:00.000Z");

interface Registry {
  ids: string[];
}
interface Board {
  pins: string[];
  colors: string[];
}

/** `board` pins `registry` ids and names colours from a code-held source; `registry` declares its ids. */
const twoDatasets = {
  sources: { colors: { owner: "src/colors", has: (id: string) => ["red", "blue"].includes(id) } },
  datasets: {
    registry: {
      owner: "src/registry",
      schema: z.strictObject({ ids: z.array(z.string()) }),
      referencesOf: () => [],
      idsOf: (data: Registry) => data.ids,
    },
    board: {
      owner: "src/board",
      schema: z.strictObject({ pins: z.array(z.string()), colors: z.array(z.string()) }),
      issuesOf: (data: Board) =>
        data.pins.flatMap((pin, i) => (pin === pin.toUpperCase() ? [] : [{ path: ["pins", i], message: `"${pin}" must be upper case` }])),
      referencesOf: (data: Board) => [
        ...data.pins.map((id, i) => ({ dataset: "registry", id, path: ["pins", i] })),
        ...data.colors.map((id, i) => ({ dataset: "colors", id, path: ["colors", i] })),
      ],
    },
  },
};

describe("checkData", () => {
  it("passes data that every check accepts", () => {
    // Arrange
    const stored = { registry: { ids: ["A", "B"] } };

    // Act
    const issues = checkData(twoDatasets, "board", { pins: ["A"], colors: ["red"] }, stored);

    // Assert
    expect(issues).toEqual([]);
  });

  it("refuses on the schema with every issue's dataset and path, and runs no later check", () => {
    // Act
    const issues = checkData(twoDatasets, "board", { pins: ["a", 7], colours: [] }, {});

    // Assert
    expect(issues.map((issue: { dataset: string; path: unknown[] }) => [issue.dataset, issue.path.join(".")])).toEqual(
      expect.arrayContaining([
        ["board", "pins.1"],
        ["board", "colors"],
        ["board", ""],
      ]),
    );
    expect(issues.some((issue: { message: string }) => issue.message.includes("colours"))).toBe(true);
    expect(issues.some((issue: { message: string }) => issue.message.includes("upper case"))).toBe(false);
  });

  it("refuses on issuesOf with every issue's dataset and path", () => {
    // Arrange
    const stored = { registry: { ids: ["A", "b", "c"] } };

    // Act
    const issues = checkData(twoDatasets, "board", { pins: ["A", "b", "c"], colors: [] }, stored);

    // Assert
    expect(issues).toEqual([
      { dataset: "board", path: ["pins", 1], message: '"b" must be upper case' },
      { dataset: "board", path: ["pins", 2], message: '"c" must be upper case' },
    ]);
  });

  it("refuses an outgoing reference to a stored dataset or a code-held source that does not resolve", () => {
    // Arrange
    const stored = { registry: { ids: ["A"] } };

    // Act
    const issues = checkData(twoDatasets, "board", { pins: ["A", "Z"], colors: ["red", "green"] }, stored);

    // Assert
    expect(issues).toEqual([
      { dataset: "board", path: ["pins", 1], message: '"Z" is not in registry' },
      { dataset: "board", path: ["colors", 1], message: '"green" is not in colors' },
    ]);
  });

  it("refuses an outgoing reference to a dataset nothing has stored yet", () => {
    // Act
    const issues = checkData(twoDatasets, "board", { pins: ["A"], colors: [] }, {});

    // Assert
    expect(issues).toEqual([{ dataset: "board", path: ["pins", 0], message: '"A" is not in registry (no stored dataset)' }]);
  });

  it("refuses removing an id a stored dataset still references, naming the referring dataset and path", () => {
    // Arrange
    const stored = { registry: { ids: ["A", "B", "C"] }, board: { pins: ["A", "B", "C"], colors: [] } };

    // Act
    const issues = checkData(twoDatasets, "registry", { ids: ["A"] }, stored);

    // Assert
    expect(issues).toEqual([
      { dataset: "board", path: ["pins", 1], message: '"B" is no longer in registry' },
      { dataset: "board", path: ["pins", 2], message: '"C" is no longer in registry' },
    ]);
  });

  it("refuses a home layout tile whose mini app is not registered, naming the tile's path and the id", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const layout = structuredClone(homeLayout) as { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };
    const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
    layout.sections[grid]!.tiles!.push({ kind: "miniapp", id: "no-such-miniapp" });
    const at = layout.sections[grid]!.tiles!.length - 1;

    // Act
    const issues = checkData(catalog, "home-layout", layout, {});

    // Assert
    expect(issues).toEqual([
      { dataset: "home-layout", path: ["sections", grid, "tiles", at, "id"], message: expect.stringContaining("no-such-miniapp") },
    ]);
  });

  it("accepts the committed home layout", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const issues = checkData(catalog, "home-layout", homeLayout, {});

    // Assert
    expect(issues).toEqual([]);
  });
});

describe("checkStored", () => {
  let mongod: TestMongod;
  let dbModule: DbModule;
  let db: Db;

  beforeAll(async () => {
    mongod = await startMongod();
    dbModule = require("../../../src/infra/db") as DbModule;
    assertConfigReaches(mongod, (require("../../../src/infra/config") as { mongo: { url: string } }).mongo.url);
    db = dbModule.getClient().db("data_tool_checks");
  }, MONGOD_START_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await dbModule?.closeClient();
    } finally {
      await mongod?.stop();
    }
  });

  beforeEach(async () => {
    await clearCollections(db);
  });

  const snapshot = async () => ({
    collections: (await db.listCollections().toArray()).map((c) => c.name).sort(),
    datasets: await db.collection("datasets").find().toArray(),
    revisions: await db.collection("dataset_revisions").find().toArray(),
    indexes: await db.collection("dataset_revisions").indexes(),
  });

  it("reports the issues of stored data and writes nothing", async () => {
    // Arrange
    await store.create(db, "registry", { ids: ["A"] }, { by: "a@example.com", now: NOW });
    await store.create(db, "board", { pins: ["A", "b"], colors: ["green"] }, { by: "a@example.com", now: NOW });
    const before = await snapshot();

    // Act
    const result = await checkStored(db, twoDatasets, ["board", "registry"]);

    // Assert
    expect(result).toEqual({
      checked: [
        { dataset: "board", revision: 1 },
        { dataset: "registry", revision: 1 },
      ],
      missing: [],
      issues: [
        { dataset: "board", path: ["pins", 1], message: '"b" must be upper case' },
        { dataset: "board", path: ["colors", 0], message: '"green" is not in colors' },
      ],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("lists a dataset with nothing stored as missing, not as an issue", async () => {
    // Arrange
    const before = await snapshot();

    // Act
    const result = await checkStored(db, twoDatasets, ["board", "registry"]);

    // Assert
    expect(result).toEqual({ checked: [], missing: ["board", "registry"], issues: [] });
    expect(await snapshot()).toEqual(before);
  });
});
