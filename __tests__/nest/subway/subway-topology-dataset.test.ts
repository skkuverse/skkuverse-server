/**
 * The subway topology's round trip between its one writer and its reader,
 * over a real `mongod` (ADR 0013, D3 and D6): what `npm run data` stores through
 * scripts/lib/datasets/store.js, SubwayTopologyRepository reads back at the
 * stored revision, as the server's schema parses it, every platform and
 * neighbor in its order. A stored document the schema refuses, or none at
 * all, reads as `null`, so nothing is served from it.
 *
 * The writer is the tool's own store module, not a copy of its document shape,
 * so a change to how the tool stores a dataset that the reader does not follow
 * fails here. The repository comes from a Nest testing module, as the app
 * builds it.
 */
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { SubwayTopologyRepository } from "../../../src/subway/topology/subway-topology.repository";
import { subwayTopologyFixture } from "../../helpers/subway/topology";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/subway/topology/subway-topology.repository");

const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: SubwayTopologyRepository;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  const { SubwayTopologyRepository: Repository } = require("../../../src/subway/topology/subway-topology.repository") as RepositoryModule;
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

describe("the subway topology stored by npm run data, read by SubwayTopologyRepository", () => {
  it("reads back revision 1 equal to the fixture, every platform and neighbor in its order", async () => {
    // Arrange
    await store.create(content, "subway-topology", subwayTopologyFixture(), { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findTopology();

    // Assert
    expect(stored).toEqual({ revision: 1, data: subwayTopologyFixture() });
    expect(JSON.stringify(stored?.data)).toBe(JSON.stringify(subwayTopologyFixture()));
  });

  it("Neighbor added: reads a push that adds KR-1-P146 at 관악 at the pushed revision", async () => {
    // Arrange
    const pushed = subwayTopologyFixture();
    pushed.neighbors["KR-1-P146"] = { line: "1", seoulName: "관악" };
    await store.create(content, "subway-topology", subwayTopologyFixture(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "subway-topology", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findTopology();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored?.revision).toBe(2);
    expect(stored?.data.neighbors["KR-1-P146"]).toEqual({ line: "1", seoulName: "관악" });
  });

  it("reads a stored document the schema refuses as null", async () => {
    // Arrange
    const refused = subwayTopologyFixture() as unknown as { platforms: Record<string, Record<string, unknown>> };
    refused.platforms["S1-4-420"]!.line = "4";
    await store.create(content, "subway-topology", refused, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findTopology();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no subway-topology dataset as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findTopology();

    // Assert
    expect(stored).toBeNull();
  });
});
