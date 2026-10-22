/**
 * The Jongro route attributes' round trip between their one writer and their
 * reader, over a real `mongod` (ADR 0013, D2, D3 and D6): what `npm run data` stores through
 * scripts/lib/datasets/store.js, BusRouteAttributesRepository reads back at the
 * stored revision, as the server's schema parses it, every route and transfer
 * line in its order. A stored document the schema refuses, or none at all,
 * reads as `null`, so no route serves it.
 *
 * The writer is the tool's own store module, not a copy of its document shape,
 * so a change to how the tool stores a dataset that the reader does not follow
 * fails here. The repository comes from a Nest testing module, as the app
 * builds it.
 */
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { routeAttributesFixture } from "../../helpers/bus/route-attributes";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/bus/route-attributes/bus-route-attributes.repository");

const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: BusRouteAttributesRepository;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  const { BusRouteAttributesRepository: Repository } = require("../../../src/bus/route-attributes/bus-route-attributes.repository") as RepositoryModule;
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

describe("the Jongro route attributes stored by npm run data, read by BusRouteAttributesRepository", () => {
  it("reads back revision 1 equal to the fixture, every route and transfer line in its order", async () => {
    // Arrange
    await store.create(content, "jongro-route-attributes", routeAttributesFixture(), { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findAttributes();

    // Assert
    expect(stored).toEqual({ revision: 1, data: routeAttributesFixture() });
    expect(JSON.stringify(stored?.data)).toBe(JSON.stringify(routeAttributesFixture()));
  });

  it("Transfer line added without a deploy: reads a push that adds line 5 to jongro07's ARS 01220 at the pushed revision", async () => {
    // Arrange
    const pushed = routeAttributesFixture();
    const jongro07 = pushed.routes.jongro07!;
    pushed.routes.jongro07 = {
      ...jongro07,
      transferLinesByArsId: {
        ...jongro07.transferLinesByArsId,
        "01220": [
          { line: "4", color: "00A5DE" },
          { line: "5", color: "996CAC" },
        ],
      },
    };
    await store.create(content, "jongro-route-attributes", routeAttributesFixture(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "jongro-route-attributes", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findAttributes();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored?.revision).toBe(2);
    expect(stored?.data.routes.jongro07?.transferLinesByArsId["01220"]?.map((line) => line.line)).toEqual(["4", "5"]);
  });

  it("reads a stored document the schema refuses as null", async () => {
    // Arrange
    const refused = routeAttributesFixture() as unknown as { routes: Record<string, Record<string, unknown>> };
    refused.routes.jongro07!.busRouteId = "100900004";
    await store.create(content, "jongro-route-attributes", refused, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findAttributes();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no jongro-route-attributes dataset as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findAttributes();

    // Assert
    expect(stored).toBeNull();
  });
});
