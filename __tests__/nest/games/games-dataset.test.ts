/**
 * The `games` dataset's round trip between its one writer and its reader, over a real `mongod` (skkuverse-app
 * add-game-factory task 2.1, design D3; ADR 0013, D3 and D6): what `npm run data` stores through
 * scripts/lib/datasets/store.js, GamesRepository reads back parsed as the server parses it, at the stored revision.
 * Revision 1 is created through the tool itself (scripts/data.js over the catalog loaded from `src/`) from the
 * empty fixture, and a push the schema refuses writes nothing, naming its path.
 *
 * The writer is the tool's own store module, not a copy of its document shape, so a change to how the tool stores
 * a dataset that the reader does not follow fails here. The repository comes from a Nest testing module, as the
 * app builds it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { GamesRepository } from "../../../src/games/games.repository";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");
const { run } = require("../../../scripts/data");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/games/games.repository");
type GamesFixture = typeof import("../../helpers/games/games-fixture");

const NOW = new Date("2026-10-21T03:00:00.000Z");
const AUTHOR = "alice@example.com";
const BASE = "skku_content";
const DEV = "skku_content_dev";
const REPO = path.join(__dirname, "../../..");
const srcLoader = (relativePath: string): unknown => require(path.join(REPO, "src", relativePath));

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: GamesRepository;
let fixtures: GamesFixture;
let root: string;

/** Runs the tool as `npm run data -- <argv>` would, against the test mongod. */
async function data(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: { MONGO_URL: mongod.uri, MONGO_CONTENT_DB_NAME: BASE },
    root,
    load: srcLoader,
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
    isTTY: false,
    ask: async () => "",
    now: () => NOW,
    whoami: () => AUTHOR,
    serverSelectionTimeoutMS: 1_000,
  });
  return { code, out: out.join(""), err: err.join("") };
}

/** Writes `body` as a plain JSON file in the working root and returns its path. */
function jsonFile(name: string, body: unknown): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, JSON.stringify(body));
  return file;
}

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  fixtures = require("../../helpers/games/games-fixture") as GamesFixture;
  const { GamesRepository: Repository } = require("../../../src/games/games.repository") as RepositoryModule;
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "games-dataset-"));
  await clearCollections(content);
  await db.getClient().db(DEV).dropDatabase();
  await db.getClient().db(BASE).dropDatabase();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a games dataset stored by npm run data, read by GamesRepository", () => {
  it("reads back the pushed games, parsed as the server parses them, at their revision", async () => {
    // Arrange
    await store.create(content, "games", fixtures.emptyGames(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "games", fixtures.listedGames(), { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findGames();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored).toEqual({ revision: 2, data: fixtures.listedGames() });
  });

  it("creates revision 1 from the empty fixture through the tool, which its checks accept", async () => {
    // Arrange
    const file = jsonFile("games.json", fixtures.emptyGames());

    // Act
    const result = await data(["push", "games", "--create", "--file", file, "--note", "import"]);

    // Assert
    expect(result.code).toBe(0);
    expect(await store.readDataset(db.getClient().db(DEV), "games")).toMatchObject({ revision: 1, data: { games: [] } });
  });

  it("refuses through the tool a revision its schema refuses, naming the path, and writes nothing", async () => {
    // Arrange
    const listed = fixtures.listedGames();
    listed.games[0]!.minHostProtocol = 0;
    const file = jsonFile("games.json", listed);

    // Act
    const result = await data(["push", "games", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain("games  games.0.minHostProtocol");
    expect(await store.readDataset(db.getClient().db(DEV), "games")).toBeNull();
  });
});
