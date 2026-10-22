/**
 * The bus stops' round trip between their one writer and their reader, over a
 * real `mongod` (ADR 0013, D3 and D6): what `npm run data` stores through scripts/lib/datasets/store.js,
 * BusStopsRepository reads back at the stored revision, as the server's schema
 * parses it, every stop, sequence and HSSC position in its order. A stored
 * document the schema refuses, or none at all, reads as `null`, so no route
 * serves it.
 *
 * The writer is the tool's own store module, not a copy of its document shape,
 * so a change to how the tool stores a dataset that the reader does not follow
 * fails here. The repository comes from a Nest testing module, as the app
 * builds it.
 */
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { busStopsFixture } from "../../helpers/bus/bus-stops";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/bus/stops/bus-stops.repository");

const NOW = new Date("2026-10-21T13:52:00.000Z");
const AUTHOR = "alice@example.com";

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: BusStopsRepository;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  const { BusStopsRepository: Repository } = require("../../../src/bus/stops/bus-stops.repository") as RepositoryModule;
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

describe("the bus stops stored by npm run data, read by BusStopsRepository", () => {
  it("reads back revision 1 equal to the fixture, every stop, sequence and HSSC position in its order", async () => {
    // Arrange
    await store.create(content, "bus-stops", busStopsFixture(), { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findStops();

    // Assert
    expect(stored).toEqual({ revision: 1, data: busStopsFixture() });
    expect(JSON.stringify(stored?.data)).toBe(JSON.stringify(busStopsFixture()));
  });

  it("Photo replaced: reads a push that changes jeongja-exit3's photo at the pushed revision", async () => {
    // Arrange
    const pushed = busStopsFixture() as { stops: Array<{ id: string; photo?: unknown }> };
    pushed.stops = pushed.stops.map((stop) => (stop.id === "jeongja-exit3" ? { ...stop, photo: { original: "https://media.skkuverse.com/stops/jeongja-exit3-v2.jpg" } } : stop));
    await store.create(content, "bus-stops", busStopsFixture(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "bus-stops", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findStops();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored?.revision).toBe(2);
    expect(stored?.data.stops.find((stop) => stop.id === "jeongja-exit3")?.photo).toEqual({ original: "https://media.skkuverse.com/stops/jeongja-exit3-v2.jpg" });
  });

  it("reads a stored document the schema refuses as null", async () => {
    // Arrange
    const refused = busStopsFixture() as { hssc: { stations: unknown[] } };
    refused.hssc.stations.pop();
    await store.create(content, "bus-stops", refused, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findStops();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no bus-stops dataset as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findStops();

    // Assert
    expect(stored).toBeNull();
  });
});
