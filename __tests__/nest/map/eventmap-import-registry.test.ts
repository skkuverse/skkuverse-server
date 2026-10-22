/**
 * The places importer checks each `miniapp` action against the mini app
 * registry its target database holds: the
 * `miniapps` dataset `npm run data` stored in the content database the importer
 * picks with its own NODE_ENV rule, read through scripts/lib/datasets/store.js.
 * A place naming an id that registry lacks is refused, so a typo cannot import
 * clean and ship a sheet whose button the server leaves out at read. With no
 * registry stored, the importer refuses to run rather than pass every id.
 *
 * Over a real `mongod`: the registry is written by the tool's own store module.
 */
import fs from "fs";
import path from "path";
import type { Db as MongoDb } from "mongodb";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");
const { parseSheet } = require("../../../scripts/import-eventmap-places");
const { resolveContentDbName } = require("../../../scripts/lib/eventmap-db");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RegistryFixture = typeof import("../../helpers/miniapps/registry-fixture");

const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";
const LAYER_SET_ID = "eskara-2026";
const REAL_FILE = path.join(__dirname, "../../../scripts/data/eskara-2026-places.json");

/** One place whose one action opens the mini app target `actionValue`. */
function sheetNaming(actionValue: string): string {
  return JSON.stringify({
    layerSetId: LAYER_SET_ID,
    campus: "nsc",
    places: [
      {
        id: "bar-01",
        category: "bar",
        lat: 37.294749,
        lng: 126.97076,
        title: "슈퍼 정통 X 경영 브라더스",
        hours: [],
        order: 70,
        actions: [{ id: "m", label: "가기", actionType: "miniapp", actionValue }],
      },
    ],
  });
}

/** Puts an env var back as it was, unset included: assigning `undefined` would store the string "undefined". */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let registries: RegistryFixture;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  registries = require("../../helpers/miniapps/registry-fixture") as RegistryFixture;
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  await content.dropDatabase();
});

describe("parseSheet", () => {
  it("refuses a place naming an id the stored registry lacks, at its action", async () => {
    // Arrange
    await store.create(content, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });

    // Act
    const { docs, errors } = await parseSheet(sheetNaming("wave-run/x"), { layerSetId: LAYER_SET_ID, contentDb: content });

    // Assert
    expect(docs).toEqual([]);
    expect(errors).toEqual(['places[0] ("bar-01").actions[0].actionValue names an unregistered mini app "wave-run"']);
  });

  it("accepts the same place once the stored registry holds the id", async () => {
    // Arrange
    await store.create(content, "miniapps", registries.fixtureRegistryWithWaveRun(), { by: AUTHOR, now: NOW });

    // Act
    const { docs, errors } = await parseSheet(sheetNaming("wave-run/x"), { layerSetId: LAYER_SET_ID, contentDb: content });

    // Assert
    expect(errors).toEqual([]);
    expect(docs.map((doc: { _id: string }) => doc._id)).toEqual(["eskara-2026-bar-01"]);
  });

  it("refuses the committed sheet against a registry without eskara-2026, at each of its actions", async () => {
    // Arrange
    const registry = registries.fixtureRegistry();
    registry.index.miniApps = registry.index.miniApps.filter((entry) => entry.id !== "eskara-2026");
    delete registry.details["eskara-2026"];
    await store.create(content, "miniapps", registry, { by: AUTHOR, now: NOW });

    // Act
    const { errors } = await parseSheet(fs.readFileSync(REAL_FILE, "utf8"), { layerSetId: LAYER_SET_ID, contentDb: content });

    // Assert
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error).toMatch(/\.actionValue names an unregistered mini app "eskara-2026"$/);
  });

  it("refuses to parse when the target database holds no registry, naming the database", async () => {
    // Act & Assert
    await expect(parseSheet(sheetNaming("eskara-2026"), { layerSetId: LAYER_SET_ID, contentDb: content })).rejects.toThrow(content.databaseName);
  });
});

describe("resolveContentDbName", () => {
  it.each([
    ["production", "skku_content"],
    ["test", "skku_content_test"],
    ["development", "skku_content_dev"],
  ])("under NODE_ENV=%s targets %s, as the importer's eventmap database does", (nodeEnv, expected) => {
    // Arrange
    const saved = { nodeEnv: process.env.NODE_ENV, base: process.env.MONGO_CONTENT_DB_NAME };
    try {
      process.env.NODE_ENV = nodeEnv;
      process.env.MONGO_CONTENT_DB_NAME = "skku_content";

      // Act
      const dbName = resolveContentDbName();

      // Assert
      expect(dbName).toBe(expected);
    } finally {
      restoreEnv("NODE_ENV", saved.nodeEnv);
      restoreEnv("MONGO_CONTENT_DB_NAME", saved.base);
    }
  });

  it("refuses to pick a database when MONGO_CONTENT_DB_NAME is unset", () => {
    // Arrange
    const saved = process.env.MONGO_CONTENT_DB_NAME;
    try {
      delete process.env.MONGO_CONTENT_DB_NAME;

      // Act & Assert
      expect(() => resolveContentDbName()).toThrow(/MONGO_CONTENT_DB_NAME/);
    } finally {
      restoreEnv("MONGO_CONTENT_DB_NAME", saved);
    }
  });
});
