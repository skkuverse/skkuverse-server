/**
 * The home layout's round trip between its one writer and its reader, over a
 * real `mongod` (move-runtime-data-to-db task 5.5; ADR 0013, D3 and D6): what
 * `npm run data` stores through scripts/lib/datasets/store.js, UiHomeRepository
 * reads back unchanged, at the stored revision, and a document whose data the
 * server's schema refuses reads as `null`, so it is never served.
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
import type { UiHomeRepository } from "../../../src/ui/home/ui-home.repository";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/ui/home/ui-home.repository");

const NOW = new Date("2026-10-19T03:00:00.000Z");
const AUTHOR = "alice@example.com";

function fixtureLayout(): Record<string, unknown> {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/home-layout.dataset.json"), "utf8")) as Record<string, unknown>;
  delete layout._about;
  return layout;
}

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: UiHomeRepository;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  const { UiHomeRepository: Repository } = require("../../../src/ui/home/ui-home.repository") as RepositoryModule;
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

describe("a home layout stored by npm run data, read by UiHomeRepository", () => {
  it("reads back the pushed layout, equal to the data pushed, at its revision", async () => {
    // Arrange
    const first = fixtureLayout();
    const pushed = fixtureLayout() as { sections: Array<Record<string, unknown>> };
    pushed.sections = pushed.sections.slice(1);
    await store.create(content, "home-layout", first, { by: AUTHOR, now: NOW });
    const result = await store.push(content, "home-layout", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored).toEqual({ revision: 2, layout: pushed });
  });

  it("reads a stored layout that holds a field the schema refuses as null", async () => {
    // Arrange
    await store.create(content, "home-layout", { ...fixtureLayout(), sectionz: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(stored).toBeNull();
  });

  it("reads a database that holds no home-layout dataset as null", async () => {
    // Arrange
    await store.create(content, "transit-layout", { version: 1, sections: [] }, { by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(stored).toBeNull();
  });
});
