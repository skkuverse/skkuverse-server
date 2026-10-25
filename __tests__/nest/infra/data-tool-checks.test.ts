/**
 * What `npm run data` refuses before a write, and what `check` reports on
 * stored data (scripts/lib/datasets/checks.js; ADR 0013, D5). Four checks, every issue
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
 *
 * `issuesOf(data, { storedOf })` gets the other datasets' content, not only
 * their ids (ADR 0013, D5): `storedOf(name)` is the pushed data for
 * the dataset being checked, the parsed stored data of any other, and null
 * when nothing is stored. A reference resolves against the copy stored in the
 * database the push targets, so two databases can answer differently.
 *
 * A parted dataset's stored data is its manifest. A dataset whose check needs
 * another's parts declares it in `reads`: `readStored` then adds each part's
 * data to that manifest, read from the same database, and `storedOf` hands
 * the parts over, parsed and ordered by key. No other check reads a part, so a
 * push of any other dataset fetches none.
 *
 * A dataset whose check reads a collection outside the content database
 * declares it in `collections`: `checkStored` and `readCollections` read each declared
 * collection through the caller's reader, which picks the target environment,
 * and `issuesOf` gets it from `collectionOf(key)`, null when it was not read.
 * A check never reads a collection its dataset does not declare, and no other
 * dataset's check reads one.
 *
 * Deleting an id another stored dataset cites is refused by the incoming
 * check. A dataset that needs more of another's content than its ids (an
 * alias that must stay, ADR 0022 D4) declares it in `recheckTriggers`: a push
 * or check of that one runs the declaring dataset's `issuesOf` again over its
 * stored data, against the content being checked and with its own collections
 * and parts read, and its refusing issues refuse the push as its own.
 */
import path from "node:path";
import type { Db } from "mongodb";
import { z } from "zod";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { checkContent, checkData, checkStored, readCollections, readStored } = require("../../../scripts/lib/datasets/checks");
const { loadCatalog } = require("../../../scripts/lib/datasets/catalog");
const parts = require("../../../scripts/lib/datasets/parts");
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

interface Table {
  line: string;
  trains: string[];
}
interface Routes {
  lines: string[];
}

/** `routes` reads the parted `tables` and refuses a line no stored table runs; `notes` reads nothing. */
const readingCatalog = {
  sources: {},
  datasets: {
    tables: {
      owner: "src/tables",
      parts: {
        schema: z.strictObject({ line: z.string(), trains: z.array(z.string().regex(/^\d\d:\d\d$/)) }),
        keyOf: (table: Table) => table.line,
        summaryOf: (table: Table) => ({ trainCount: table.trains.length }),
      },
      referencesOf: () => [],
    },
    routes: {
      owner: "src/routes",
      schema: z.strictObject({ lines: z.array(z.string()) }),
      reads: ["tables"],
      issuesOf: (routes: Routes, { storedOf }: { storedOf: (name: string) => Table[] | null }) => {
        const tables = storedOf("tables");
        if (tables === null) return [{ path: [], message: "no stored tables" }];
        return routes.lines.flatMap((line, i) => (tables.some((table) => table.line === line) ? [] : [{ path: ["lines", i], message: `no stored table runs line ${line}` }]));
      },
      referencesOf: () => [],
    },
    notes: {
      owner: "src/notes",
      schema: z.strictObject({ text: z.string() }),
      referencesOf: () => [],
    },
  },
};

interface Runs {
  stopCount: number;
}
interface TimetableDoc {
  id: string;
  stopTimes: string[];
}
type CollectionOf = (key: string) => TimetableDoc[] | null;

/** `runs` checks its stop count against the declared `timetables` collection; `notes` declares none. */
const collectionCatalog = {
  sources: {},
  collections: { timetables: { database: "MONGO_DB_NAME_TIMETABLES", name: "timetables" } },
  datasets: {
    runs: {
      owner: "src/runs",
      schema: z.strictObject({ stopCount: z.number() }),
      collections: ["timetables"],
      issuesOf: (runs: Runs, { collectionOf }: { collectionOf: CollectionOf }) => {
        const docs = collectionOf("timetables");
        if (docs === null) return [{ path: [], message: "timetables not read", warning: true }];
        return docs.flatMap((doc) => (doc.stopTimes.length === runs.stopCount ? [] : [{ path: ["stopCount"], message: `${doc.id} lists ${doc.stopTimes.length}` }]));
      },
      referencesOf: () => [],
    },
    notes: {
      owner: "src/notes",
      schema: z.strictObject({ text: z.string() }),
      referencesOf: () => [],
    },
  },
};

/** collectionCatalog with a `notes` check that reads `timetables`, which `notes` does not declare. */
const undeclaredReadCatalog = {
  ...collectionCatalog,
  datasets: {
    ...collectionCatalog.datasets,
    notes: {
      ...collectionCatalog.datasets.notes,
      issuesOf: (_notes: unknown, { collectionOf }: { collectionOf: CollectionOf }) => (collectionOf("timetables") ?? []).map(() => ({ path: [], message: "read" })),
    },
  },
};

interface Stop {
  id: string;
  aliases?: string[];
}
interface Journeys {
  stops: string[];
  poles: string[];
}
type StoredOf = (name: string) => unknown;

/**
 * `stops` lists stops, each pole only through a stop's alias, and declares its ids; `journeys` cites stop ids, and
 * names poles that must stay some stop's alias in `storedOf("stops")`, so it declares `recheckTriggers: ["stops"]`
 * and the `timetables` collection, whose absence it reports as a warning.
 */
const recheckCatalog = {
  sources: {},
  collections: { timetables: { database: "MONGO_DB_NAME_TIMETABLES", name: "timetables" } },
  datasets: {
    stops: {
      owner: "src/stops",
      schema: z.strictObject({ stops: z.array(z.strictObject({ id: z.string(), aliases: z.array(z.string()).optional() })) }),
      referencesOf: () => [],
      idsOf: (data: { stops: Stop[] }) => data.stops.map((stop) => stop.id),
    },
    journeys: {
      owner: "src/journeys",
      schema: z.strictObject({ stops: z.array(z.string()), poles: z.array(z.string()) }),
      recheckTriggers: ["stops"],
      collections: ["timetables"],
      issuesOf: (journeys: Journeys, { storedOf, collectionOf }: { storedOf: StoredOf; collectionOf: CollectionOf }) => {
        const stops = (storedOf("stops") as { stops: Stop[] } | null)?.stops ?? [];
        const unaliased = journeys.poles.flatMap((pole, i) => (stops.some((stop) => stop.aliases?.includes(pole)) ? [] : [{ path: ["poles", i], message: `pole ${pole} is no stop's alias` }]));
        const unread = collectionOf("timetables") === null ? [{ path: [], message: "timetables not read", warning: true }] : [];
        return [...unaliased, ...unread];
      },
      referencesOf: (journeys: Journeys) => journeys.stops.map((id, i) => ({ dataset: "stops", id, path: ["stops", i] })),
    },
    notes: {
      owner: "src/notes",
      schema: z.strictObject({ text: z.string() }),
      referencesOf: () => [],
    },
  },
};

const sadangStops = { stops: [{ id: "nsc-skku-to-sadang", aliases: ["200000162"] }, { id: "hssc-bus-lot" }] };
const sadangJourneys = { stops: ["nsc-skku-to-sadang"], poles: ["200000162"] };

const partOf = (table: Table) => ({ key: table.line, data: table, summary: { trainCount: table.trains.length } });
const line1 = { line: "1", trains: ["05:30"] };
const line2 = { line: "2", trains: ["05:31"] };

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

  it("refuses a home layout that places a tile twice, naming the second placement", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const layout = structuredClone(homeLayout) as { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };
    const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
    const tiles = layout.sections[grid]!.tiles!;
    tiles.push(structuredClone(tiles[0]!));

    // Act
    const issues = checkData(catalog, "home-layout", layout, {});

    // Assert
    expect(issues).toEqual([
      { dataset: "home-layout", path: ["sections", grid, "tiles", tiles.length - 1, "id"], message: `tile "${tiles[0]!.id}" is placed more than once` },
    ]);
  });

  it("refuses a home layout link tile whose icon is two emoji, naming the icon's path", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);
    const layout = structuredClone(homeLayout) as { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };
    const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
    const tile = layout.sections[grid]!.tiles![0]!;
    tile.icon = { kind: "emoji", emoji: "🗺️🗺️" };

    // Act
    const issues = checkData(catalog, "home-layout", layout, {});

    // Assert
    expect(issues).toEqual([
      { dataset: "home-layout", path: ["sections", grid, "tiles", 0, "icon", "emoji"], message: `"${tile.id}" icon must be exactly one emoji` },
    ]);
  });

  it("accepts revision 1 of the stored home layout", () => {
    // Arrange
    const catalog = loadCatalog(srcLoader);

    // Act
    const issues = checkData(catalog, "home-layout", homeLayout, {});

    // Assert
    expect(issues).toEqual([]);
  });
});

describe("checkData's issuesOf context", () => {
  /** `pinboard`'s issuesOf records what storedOf answers; `registry` parses its ids upper-cased. */
  function recordingCatalog(asked: string[]): { seen: Record<string, unknown>; catalog: unknown } {
    const seen: Record<string, unknown> = {};
    const catalog = {
      sources: {},
      datasets: {
        registry: {
          owner: "src/registry",
          schema: z.strictObject({ ids: z.array(z.string().transform((id) => id.toUpperCase())) }),
          referencesOf: () => [],
          idsOf: (data: Registry) => data.ids,
        },
        pinboard: {
          owner: "src/pinboard",
          schema: z.strictObject({ pins: z.array(z.string()) }),
          issuesOf: (_data: unknown, { storedOf }: { storedOf: (name: string) => unknown }) => {
            for (const name of asked) seen[name] = storedOf(name);
            return [];
          },
          referencesOf: (data: { pins: string[] }) => data.pins.map((id, i) => ({ dataset: "registry", id, path: ["pins", i] })),
        },
      },
    };
    return { seen, catalog };
  }

  it("hands issuesOf the pushed data under its own name, the parsed stored data of another, and null for none stored", () => {
    // Arrange
    const { seen, catalog } = recordingCatalog(["pinboard", "registry", "nothing"]);

    // Act
    checkData(catalog, "pinboard", { pins: ["A"] }, { registry: { ids: ["a", "b"] } });

    // Assert
    expect(seen).toEqual({ pinboard: { pins: ["A"] }, registry: { ids: ["A", "B"] }, nothing: null });
  });

  it("hands issuesOf the data being pushed when it asks for its own dataset by name", () => {
    // Arrange
    const { seen, catalog } = recordingCatalog(["registry"]);
    (catalog as { datasets: { registry: Record<string, unknown> } }).datasets.registry.issuesOf = (_data: unknown, { storedOf }: { storedOf: (name: string) => unknown }) => {
      seen.registry = storedOf("registry");
      return [];
    };

    // Act
    checkData(catalog, "registry", { ids: ["c"] }, { registry: { ids: ["a", "b"] } });

    // Assert
    expect(seen.registry).toEqual({ ids: ["C"] });
  });

  it("resolves a reference against the copy stored in the database the push targets", () => {
    // Arrange
    const { catalog } = recordingCatalog([]);
    const development = { registry: { ids: ["a", "wave"] } };
    const production = { registry: { ids: ["a"] } };

    // Act
    const toDevelopment = checkData(catalog, "pinboard", { pins: ["WAVE"] }, development);
    const toProduction = checkData(catalog, "pinboard", { pins: ["WAVE"] }, production);

    // Assert
    expect(toDevelopment).toEqual([]);
    expect(toProduction).toEqual([{ dataset: "pinboard", path: ["pins", 0], message: '"WAVE" is not in registry' }]);
  });
});

describe("checkData's storedOf for a parted dataset", () => {
  it("hands a check the parts of a dataset it reads, parsed and ordered by key, from the manifest readStored filled", () => {
    // Arrange
    const stored = { tables: { parts: [{ key: "2", data: line2 }, { key: "1", data: line1 }] } };

    // Act
    const issues = [["1", "2"], ["1", "3"]].map((lines) => checkData(readingCatalog, "routes", { lines }, stored));

    // Assert
    expect(issues).toEqual([[], [{ dataset: "routes", path: ["lines", 1], message: "no stored table runs line 3" }]]);
  });

  it("hands over the parts in key order whatever order the manifest lists them in", () => {
    // Arrange
    const seen: unknown[] = [];
    const recording = {
      ...readingCatalog,
      datasets: {
        ...readingCatalog.datasets,
        routes: {
          ...readingCatalog.datasets.routes,
          issuesOf: (_routes: Routes, { storedOf }: { storedOf: (name: string) => unknown }) => {
            seen.push(storedOf("tables"));
            return [];
          },
        },
      },
    };

    // Act
    checkData(recording, "routes", { lines: [] }, { tables: { parts: [{ key: "2", data: line2 }, { key: "1", data: line1 }] } });

    // Assert
    expect(seen).toEqual([[line1, line2]]);
  });

  it("reads a parted dataset as null when its manifest lacks a part's data or a part fails its schema", () => {
    // Arrange
    const unread = { tables: { parts: [{ key: "1", partId: "tables/1@0" }] } };
    const malformed = { tables: { parts: [{ key: "1", data: { line: "1", trains: ["5:30"] } }] } };

    // Act
    const issues = [unread, malformed].map((stored) => checkData(readingCatalog, "routes", { lines: ["1"] }, stored));

    // Assert
    expect(issues).toEqual([
      [{ dataset: "routes", path: [], message: "no stored tables" }],
      [{ dataset: "routes", path: [], message: "no stored tables" }],
    ]);
  });
});

describe("checkData's collectionOf", () => {
  it("hands a check the declared collection it was given, and refuses on what it finds there", () => {
    // Act
    const issues = checkData(collectionCatalog, "runs", { stopCount: 3 }, {}, { timetables: [{ id: "a", stopTimes: ["07:40", "08:45"] }] });

    // Assert
    expect(issues).toEqual([{ dataset: "runs", path: ["stopCount"], message: "a lists 2" }]);
  });

  it("hands null for a declared collection that was not read, which the check reports as a warning", () => {
    // Act
    const { issues, warnings } = checkContent(collectionCatalog, "runs", { stopCount: 3 }, {});

    // Assert
    expect(issues).toEqual([]);
    expect(warnings).toEqual([{ dataset: "runs", path: [], message: "timetables not read", warning: true }]);
  });

  it("throws when a check reads a collection its dataset does not declare", () => {
    // Act & Assert
    expect(() => checkData(undeclaredReadCatalog, "notes", { text: "x" }, {}, { timetables: [] })).toThrow('notes reads the collection "timetables", which its catalog entry does not declare');
  });
});

describe("checkData's incoming references and recheckTriggers", () => {
  it("refuses deleting a stop another dataset cites, naming the citing dataset and path", () => {
    // Arrange
    const stored = { stops: sadangStops, journeys: sadangJourneys };

    // Act
    const issues = checkData(recheckCatalog, "stops", { stops: [{ id: "hssc-bus-lot" }] }, stored, { timetables: [] });

    // Assert
    expect(issues).toContainEqual({ dataset: "journeys", path: ["stops", 0], message: '"nsc-skku-to-sadang" is no longer in stops' });
  });

  it("refuses a push that only removes an alias, as the declaring dataset's own check of its stored data against the pushed content", () => {
    // Arrange
    const stored = { stops: sadangStops, journeys: sadangJourneys };
    const withoutAlias = { stops: [{ id: "nsc-skku-to-sadang" }, { id: "hssc-bus-lot" }] };

    // Act
    const issues = checkData(recheckCatalog, "stops", withoutAlias, stored, { timetables: [] });

    // Assert
    expect(issues).toEqual([{ dataset: "journeys", path: ["poles", 0], message: "pole 200000162 is no stop's alias" }]);
  });

  it("passes a push that keeps the alias, and runs no recheck while the declaring dataset is not stored", () => {
    // Arrange
    const renamed = { stops: [{ id: "nsc-skku-to-sadang", aliases: ["200000162"] }, { id: "hssc-600th" }] };

    // Act
    const kept = checkData(recheckCatalog, "stops", renamed, { stops: sadangStops, journeys: sadangJourneys }, { timetables: [] });
    const unstored = checkData(recheckCatalog, "stops", { stops: [] }, { stops: sadangStops }, { timetables: [] });

    // Assert
    expect(kept).toEqual([]);
    expect(unstored).toEqual([]);
  });

  it("refuses on the recheck's issues only: its warnings neither refuse nor print as the pushed dataset's", () => {
    // Arrange
    const stored = { stops: sadangStops, journeys: sadangJourneys };

    // Act
    const result = checkContent(recheckCatalog, "stops", sadangStops, stored);

    // Assert
    expect(result).toEqual({ issues: [], warnings: [] });
  });

  it("runs no recheck for a dataset no entry names in its recheckTriggers", () => {
    // Arrange
    const stored = { stops: sadangStops, journeys: { ...sadangJourneys, poles: ["999999999"] } };

    // Act
    const issues = checkData(recheckCatalog, "notes", { text: "x" }, stored, {});

    // Assert
    expect(issues).toEqual([]);
  });

  it("readCollections reads the collections of each dataset that a pushed one triggers a recheck of", async () => {
    // Arrange
    const reader = jest.fn(async () => []);

    // Act
    const forStops = await readCollections(recheckCatalog, ["stops"], reader);
    const forNotes = await readCollections(recheckCatalog, ["notes"], reader);

    // Assert
    expect(forStops).toEqual({ timetables: [] });
    expect(forNotes).toEqual({});
    expect(reader.mock.calls).toEqual([["timetables", recheckCatalog.collections.timetables]]);
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

  /** `real`, counting each time a read opens `dataset_parts`. */
  function countingPartReads(real: Db): { db: Db; reads: () => number } {
    let count = 0;
    const counted = new Proxy(real, {
      get(target, property, receiver) {
        if (property !== "collection") return Reflect.get(target, property, receiver);
        return (name: string) => {
          if (name === "dataset_parts") count += 1;
          return target.collection(name);
        };
      },
    });
    return { db: counted, reads: () => count };
  }

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

  it("readStored adds each part's data to the manifest of a dataset a checked one reads, and reads no part for any other", async () => {
    // Arrange
    await parts.create(db, "tables", [partOf(line1), partOf(line2)], { by: "a@example.com", now: NOW });
    const counted = countingPartReads(db);

    // Act
    const forNotes = await readStored(counted.db, readingCatalog, ["notes"]);
    const readsForNotes = counted.reads();
    const forRoutes = await readStored(counted.db, readingCatalog, ["routes"]);

    // Assert
    expect(readsForNotes).toBe(0);
    expect(forNotes.stored.tables.parts.map((entry: Record<string, unknown>) => Object.keys(entry).sort())).toEqual([
      ["key", "partId", "summary"],
      ["key", "partId", "summary"],
    ]);
    expect(forRoutes.stored.tables.parts.map((entry: { key: string; data: Table }) => [entry.key, entry.data])).toEqual([
      ["1", line1],
      ["2", line2],
    ]);
    expect(forRoutes.revisions).toEqual({ tables: 1 });
  });

  it("checks a dataset that reads a parted one against the parts stored in its own database, never another's", async () => {
    // Arrange
    const other = dbModule.getClient().db("data_tool_checks_other");
    await other.dropDatabase();
    await parts.create(db, "tables", [partOf(line1), partOf(line2)], { by: "a@example.com", now: NOW });
    await parts.create(other, "tables", [partOf(line1)], { by: "a@example.com", now: NOW });
    await store.create(db, "routes", { lines: ["1", "2"] }, { by: "a@example.com", now: NOW });
    await store.create(other, "routes", { lines: ["1", "2"] }, { by: "a@example.com", now: NOW });

    // Act
    const here = await checkStored(db, readingCatalog, ["routes"]);
    const there = await checkStored(other, readingCatalog, ["routes"]);

    // Assert
    expect(here.issues).toEqual([]);
    expect(there.issues).toEqual([{ dataset: "routes", path: ["lines", 1], message: "no stored table runs line 2" }]);
    await other.dropDatabase();
  });

  it("reads each collection a checked, stored dataset declares through the reader, and none for any other", async () => {
    // Arrange
    await store.create(db, "runs", { stopCount: 3 }, { by: "a@example.com", now: NOW });
    await store.create(db, "notes", { text: "x" }, { by: "a@example.com", now: NOW });
    const reader = jest.fn(async () => [{ id: "a", stopTimes: ["07:40", "08:45"] }]);

    // Act
    const forNotes = await checkStored(db, collectionCatalog, ["notes"], reader);
    const readsForNotes = reader.mock.calls.length;
    const forBoth = await checkStored(db, collectionCatalog, ["runs", "notes"], reader);

    // Assert
    expect(readsForNotes).toBe(0);
    expect(forNotes.issues).toEqual([]);
    expect(reader.mock.calls).toEqual([["timetables", collectionCatalog.collections.timetables]]);
    expect(forBoth.issues).toEqual([{ dataset: "runs", path: ["stopCount"], message: "a lists 2" }]);
  });

  it("readCollections reads the collections the named datasets declare, once each, and nothing for a dataset that declares none", async () => {
    // Arrange
    const reader = jest.fn(async () => []);

    // Act
    const forNotes = await readCollections(collectionCatalog, ["notes"], reader);
    const forRuns = await readCollections(collectionCatalog, ["runs", "runs"], reader);

    // Assert
    expect(forNotes).toEqual({});
    expect(forRuns).toEqual({ timetables: [] });
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("rechecks each stored dataset that declares a checked one in recheckTriggers, reading its collections", async () => {
    // Arrange
    await store.create(db, "stops", { stops: [{ id: "nsc-skku-to-sadang" }] }, { by: "a@example.com", now: NOW });
    await store.create(db, "journeys", sadangJourneys, { by: "a@example.com", now: NOW });
    const reader = jest.fn(async () => []);

    // Act
    const result = await checkStored(db, recheckCatalog, ["stops"], reader);

    // Assert
    expect(result.issues).toEqual([{ dataset: "journeys", path: ["poles", 0], message: "pole 200000162 is no stop's alias" }]);
    expect(reader.mock.calls).toEqual([["timetables", recheckCatalog.collections.timetables]]);
  });

  it("readStored adds the parts of a parted dataset a checked one triggers a recheck of, which the recheck reads", async () => {
    // Arrange
    const partedRecheck = {
      sources: {},
      datasets: {
        tables: {
          ...readingCatalog.datasets.tables,
          recheckTriggers: ["notes"],
          issuesOf: (tables: Table[], { storedOf }: { storedOf: StoredOf }) =>
            (storedOf("notes") as { text: string }).text === "no line 2" && tables.some((table) => table.line === "2") ? [{ path: ["2"], message: "line 2 is stored" }] : [],
        },
        notes: readingCatalog.datasets.notes,
      },
    };
    await parts.create(db, "tables", [partOf(line1), partOf(line2)], { by: "a@example.com", now: NOW });
    await store.create(db, "notes", { text: "x" }, { by: "a@example.com", now: NOW });

    // Act
    const { stored } = await readStored(db, partedRecheck, ["notes"]);
    const issues = checkData(partedRecheck, "notes", { text: "no line 2" }, stored);

    // Assert
    expect(stored.tables.parts.map((entry: { data?: Table }) => entry.data?.line)).toEqual(["1", "2"]);
    expect(issues).toEqual([{ dataset: "tables", path: ["2"], message: "line 2 is stored" }]);
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
