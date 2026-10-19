/**
 * The festival layer sets' round trip between their one writer and their
 * reader, over a real `mongod` (move-editorial-datasets task 8.5; ADR 0013, D3
 * and D6): what `npm run data` stores through scripts/lib/datasets/store.js,
 * MapLayerSetRepository reads back at the stored revision, each set as the
 * server's schema parses it. A stored set the schema refuses is left out and
 * the others still read; a document whose envelope it refuses reads as `null`,
 * so it is never served.
 *
 * The writer is the tool's own store module, not a copy of its document shape,
 * so a change to how the tool stores a dataset that the reader does not follow
 * fails here. The repository comes from a Nest testing module, as the app
 * builds it.
 */
import fs from "fs";
import path from "path";
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { MapLayerSetRepository } from "../../../src/map/layer-set/map-layer-set.repository";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/map/layer-set/map-layer-set.repository");
type SchemaModule = typeof import("../../../src/map/layer-set/map-layer-set.schema");

const NOW = new Date("2026-10-19T03:00:00.000Z");
const AUTHOR = "alice@example.com";

function fixtureLayerSets(): { layerSets: Array<Record<string, any>> } {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/map-layer-sets.dataset.json"), "utf8")) as {
    _about?: string;
    layerSets: Array<Record<string, any>>;
  };
  delete dataset._about;
  return dataset;
}

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: MapLayerSetRepository;
let checkedLayerSet: SchemaModule["checkedLayerSet"];

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  ({ checkedLayerSet } = require("../../../src/map/layer-set/map-layer-set.schema") as SchemaModule);
  const { MapLayerSetRepository: Repository } = require("../../../src/map/layer-set/map-layer-set.repository") as RepositoryModule;
  const testingModule = await Test.createTestingModule({ providers: [Repository] }).compile();
  repository = testingModule.get(Repository);
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

describe("map layer sets stored by npm run data, read by MapLayerSetRepository", () => {
  it("reads back the pushed sets, each parsed as the server parses it, at their revision", async () => {
    // Arrange
    const pushed = fixtureLayerSets();
    pushed.layerSets.push({ ...structuredClone(pushed.layerSets[0]!), layerSetId: "spring-2027", emoji: "🌸" });
    await store.create(content, "map-layer-sets", fixtureLayerSets(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "map-layer-sets", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored).toEqual({ revision: 2, layerSets: pushed.layerSets.map((set) => checkedLayerSet.parse(set)), rejected: [] });
  });

  it("leaves out a stored set the schema refuses and reads the others", async () => {
    // Arrange
    const data = fixtureLayerSets();
    data.layerSets.unshift({ ...structuredClone(data.layerSets[0]!), layerSetId: "spring-2027", timezone: "Asia/Tokyo" });
    await store.create(content, "map-layer-sets", data, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored?.layerSets.map((set) => set.layerSetId)).toEqual(["eskara-2026"]);
    expect(stored?.rejected).toEqual([{ index: 0, layerSetId: "spring-2027", issues: [expect.stringMatching(/^timezone: /)] }]);
  });

  it("reads a stored document whose envelope the schema refuses as null", async () => {
    // Arrange
    await store.create(content, "map-layer-sets", { layerSet: fixtureLayerSets().layerSets[0] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no map-layer-sets dataset as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findLayerSets();

    // Assert
    expect(stored).toBeNull();
  });
});
