/**
 * SKKU's rest days' round trip between their one writer and their reader,
 * over a real `mongod` (ADR 0013, D3 and D6): what `npm run data` stores through scripts/lib/datasets/store.js,
 * BusScheduleContentRepository reads back at the stored revision, each MM-DD
 * key as a yearly rest day and each YYYY-MM-DD key as a one-off one. A stored
 * document the schema refuses, or none at all, reads as `null`, so it is never
 * served.
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

function fixtureRestDays(): Record<string, string> {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/skku-rest-days.dataset.json"), "utf8")) as Record<string, string>;
  delete dataset._about;
  return dataset;
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

describe("rest days stored by npm run data, read by BusScheduleContentRepository", () => {
  it("reads back revision 1 as its two yearly rest days", async () => {
    // Arrange
    await store.create(content, "skku-rest-days", fixtureRestDays(), { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(stored).toEqual({ revision: 1, restDays: { exact: new Map(), annual: new Map([["09-25", "건학기념일"], ["09-28", "공자탄신일"]]) } });
  });

  it("reads a pushed one-off rest day at the pushed revision", async () => {
    // Arrange
    await store.create(content, "skku-rest-days", fixtureRestDays(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "skku-rest-days", { ...fixtureRestDays(), "2027-03-02": "학사휴교" }, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored?.revision).toBe(2);
    expect(stored?.restDays.exact).toEqual(new Map([["2027-03-02", "학사휴교"]]));
  });

  it("reads a stored document the schema refuses as null", async () => {
    // Arrange
    await store.create(content, "skku-rest-days", { ...fixtureRestDays(), "02-30": "휴일" }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no skku-rest-days dataset as null", async () => {
    // Arrange
    await store.create(content, "bus-service-notices", { services: {} }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findRestDays();

    // Assert
    expect(stored).toBeNull();
  });
});
