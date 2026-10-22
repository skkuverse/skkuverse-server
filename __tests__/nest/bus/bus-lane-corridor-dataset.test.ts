/**
 * The bus-lane corridor's round trip between its one writer and its reader,
 * over a real `mongod` (ADR 0013, D2, D3 and D6): what `npm run data` stores through scripts/lib/datasets/store.js,
 * BusEtaLaneRepository reads back at the stored revision, as the server's
 * schema parses it, every centerline vertex and probe route in its order. A
 * stored document the schema refuses, or none at all, reads as `null`, so the
 * live tick never uses it.
 *
 * The writer is the tool's own store module, not a copy of its document shape,
 * so a change to how the tool stores a dataset that the reader does not follow
 * fails here. The repository comes from a Nest testing module, as the app
 * builds it.
 */
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { BusEtaLaneRepository } from "../../../src/bus/eta/lane/bus-eta-lane.repository";
import { corridorFixture } from "../../helpers/bus/bus-lane-corridor";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/bus/eta/lane/bus-eta-lane.repository");

const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: BusEtaLaneRepository;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  const { BusEtaLaneRepository: Repository } = require("../../../src/bus/eta/lane/bus-eta-lane.repository") as RepositoryModule;
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

describe("the bus-lane corridor stored by npm run data, read by BusEtaLaneRepository", () => {
  it("reads back revision 1 equal to the fixture, every vertex and probe route in its order", async () => {
    // Arrange
    await store.create(content, "bus-lane-corridor", corridorFixture(), { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findCorridor();

    // Assert
    expect(stored).toEqual({ revision: 1, data: corridorFixture() });
    expect(JSON.stringify(stored?.data)).toBe(JSON.stringify(corridorFixture()));
  });

  it("Probe routes edited: reads a push that drops 8800 at the pushed revision", async () => {
    // Arrange
    const pushed = corridorFixture();
    pushed.probeRoutes = pushed.probeRoutes.filter((route) => route.routeId !== "200000205");
    await store.create(content, "bus-lane-corridor", corridorFixture(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "bus-lane-corridor", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findCorridor();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored?.revision).toBe(2);
    expect(stored?.data.probeRoutes.map((route) => route.name)).toEqual(["5000", "5005"]);
  });

  it("reads a stored document the schema refuses as null", async () => {
    // Arrange
    await store.create(content, "bus-lane-corridor", { ...corridorFixture(), strategies: {} }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findCorridor();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no bus-lane-corridor dataset as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findCorridor();

    // Assert
    expect(stored).toBeNull();
  });
});
