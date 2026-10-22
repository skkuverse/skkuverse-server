/**
 * The shuttle service notices' round trip between their one writer and their
 * reader, over a real `mongod` (ADR 0013, D3 and D6): what `npm run data` stores through scripts/lib/datasets/store.js,
 * BusScheduleContentRepository reads back at the stored revision, as the
 * server's schema parses it, every notice in its order. A stored document the
 * schema refuses, or none at all, reads as `null`, so it is never served.
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
import type { BusScheduleContentRepository } from "../../../src/bus/schedule-content/bus-schedule-content.repository";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/bus/schedule-content/bus-schedule-content.repository");

const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";

function fixtureNotices(): { services: Record<string, any> } {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/bus-service-notices.dataset.json"), "utf8")) as Record<string, any>;
  delete dataset._about;
  return dataset as { services: Record<string, any> };
}

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: BusScheduleContentRepository;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  const { BusScheduleContentRepository: Repository } = require("../../../src/bus/schedule-content/bus-schedule-content.repository") as RepositoryModule;
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

describe("service notices stored by npm run data, read by BusScheduleContentRepository", () => {
  it("reads back revision 1 as stored, every service and notice in its order", async () => {
    // Arrange
    await store.create(content, "bus-service-notices", fixtureNotices(), { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findServiceNotices();

    // Assert
    expect(stored).toEqual({ revision: 1, services: fixtureNotices().services });
    expect(JSON.stringify(stored?.services)).toBe(JSON.stringify(fixtureNotices().services));
  });

  it("reads a pushed suspension at the pushed revision", async () => {
    // Arrange
    const pushed = fixtureNotices();
    pushed.services["campus-inja"].suspend = { from: "2026-12-21", until: "2027-02-28" };
    await store.create(content, "bus-service-notices", fixtureNotices(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "bus-service-notices", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findServiceNotices();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored?.revision).toBe(2);
    expect(stored?.services["campus-inja"]).toEqual({ notices: fixtureNotices().services["campus-inja"].notices, suspend: { from: "2026-12-21", until: "2027-02-28" } });
  });

  it("reads a stored document the schema refuses as null", async () => {
    // Arrange
    const data = fixtureNotices();
    data.services["campus-inja"].notices[0].style = "warnig";
    await store.create(content, "bus-service-notices", data, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findServiceNotices();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no bus-service-notices dataset as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findServiceNotices();

    // Assert
    expect(stored).toBeNull();
  });
});
