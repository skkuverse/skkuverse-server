/**
 * The `games` dataset's round trip between its one writer and its reader, over a real `mongod` (skkuverse-app
 * add-game-factory task 2.1, design D3; ADR 0013, D3 and D6): what `npm run data` stores through
 * scripts/lib/datasets/store.js, GamesRepository reads back parsed as the server parses it, at the stored revision.
 * Revision 1 is created through the tool itself (scripts/data.js over the catalog loaded from `src/`) from the
 * empty fixture, and a push the schema refuses writes nothing, naming its path.
 *
 * And the checks a push keeps across datasets (task 2.2, designs D2 and D3), run through the tool against the `_dev`
 * content database of one `mongod`:
 *   - mini apps and games share one id namespace: a games push listing an id the stored mini-app registry holds
 *     is refused, and so is a miniapps push registering an id the stored games list, each naming the id;
 *   - an entry URL must be on the origin src/infra/origins.ts maps to the game's id;
 *   - a home layout's game tile names a game the stored games list, or one of the games installed builds ship
 *     bundled: a tile for neither is refused, naming the tile's path and the id, and a games push that drops a
 *     listed game a stored layout still names is refused, naming home-layout.
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
type RegistryFixture = typeof import("../../helpers/miniapps/registry-fixture");
type Layout = { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };

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
let registries: RegistryFixture;
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

/** Pulls `dataset` from `_dev`, edits its working file with `edit`, and pushes it back. */
async function pullEditPush(dataset: string, edit: (data: never) => unknown): Promise<{ code: number; out: string; err: string }> {
  await data(["pull", dataset]);
  const file = path.join(root, ".data", "dev", `${dataset}.json`);
  const working = JSON.parse(fs.readFileSync(file, "utf8")) as { data: never };
  working.data = edit(working.data) as never;
  fs.writeFileSync(file, JSON.stringify(working, null, 2));
  return data(["push", dataset]);
}

/** The stored home layout fixture with a `game` tile `id` at the end of its grid, and that tile's id path. */
function layoutWithGameTile(id: string): { layout: Layout; tilePath: string } {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "../ui/fixtures/home-layout.dataset.json"), "utf8")) as Layout & { _about?: string };
  delete layout._about;
  const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
  const tiles = layout.sections[grid]!.tiles!.filter((tile) => tile.id !== id);
  tiles.push({ kind: "game", id });
  layout.sections[grid]!.tiles = tiles;
  return { layout, tilePath: `sections.${grid}.tiles.${tiles.length - 1}.id` };
}

/** The mini-app registry fixture with a third-party mini app `id` registered. */
function registryWith(id: string): ReturnType<RegistryFixture["fixtureRegistry"]> {
  const registry = registries.fixtureRegistry();
  registry.index.miniApps.push({ id, name: id, order: 60, homeLogo: { kind: "emoji", emoji: "🎮" } });
  registry.details[id] = { version: 1, id, startUrl: `https://${id}.example.com/`, verified: false, relatedLinks: [] };
  return registry;
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
  registries = require("../../helpers/miniapps/registry-fixture") as RegistryFixture;
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

describe("one id namespace across the games and the mini-app registry", () => {
  it("refuses a games push listing an id the stored mini-app registry holds, naming the id, and writes nothing", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    await store.create(dev, "miniapps", registryWith("apple-game"), { by: AUTHOR, now: NOW });
    const file = jsonFile("games.json", fixtures.listedGames());

    // Act
    const result = await data(["push", "games", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain('games  games.0.id  "apple-game" is already an id in miniapps');
    expect(await store.readDataset(dev, "games")).toBeNull();
  });

  it("refuses a games push listing timetable while the mini-app registry has timetable, naming the id", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    await store.create(dev, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
    const listed = fixtures.listedGames();
    listed.games.push({ id: "timetable", entryUrl: "https://timetable.game.skkuverse.com/", enabled: true, minHostProtocol: 1 });
    const file = jsonFile("games.json", listed);

    // Act
    const result = await data(["push", "games", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain('games  games.2.id  "timetable" is already an id in miniapps');
  });

  it("refuses a miniapps push registering an id the stored games list, naming the id, and writes nothing", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    await store.create(dev, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
    await store.create(dev, "games", fixtures.listedGames(), { by: AUTHOR, now: NOW });
    const position = registries.fixtureRegistry().index.miniApps.length;

    // Act
    const result = await pullEditPush("miniapps", () => registryWith("suika-game"));

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`miniapps  index.miniApps.${position}.id  "suika-game" is already an id in games`);
    expect((await store.readDataset(dev, "miniapps")).revision).toBe(1);
  });

  it("accepts a games push whose ids no stored mini app holds", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    await store.create(dev, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
    const file = jsonFile("games.json", fixtures.listedGames());

    // Act
    const result = await data(["push", "games", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(0);
    expect((await store.readDataset(dev, "games")).revision).toBe(1);
  });
});

describe("a games push whose entry URL is off its game's origin", () => {
  it.each([
    ["another game's origin", "https://suika-game.game.skkuverse.com/"],
    ["a mini app's origin", "https://mukja.mini.skkuverse.com/"],
  ])("is refused on %s, naming the entry URL's path, and writes nothing", async (_case, entryUrl) => {
    // Arrange
    const listed = fixtures.listedGames();
    listed.games[0]!.entryUrl = entryUrl;
    const file = jsonFile("games.json", listed);

    // Act
    const result = await data(["push", "games", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain('games  games.0.entryUrl  "apple-game" owns https://apple-game.game.skkuverse.com, so its entryUrl must be on it');
    expect(await store.readDataset(db.getClient().db(DEV), "games")).toBeNull();
  });

  it("is refused for an id no first-party game origin maps to, naming the id", async () => {
    // Arrange
    const file = jsonFile("games.json", { games: [{ id: "new-game", entryUrl: "https://new-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 }] });

    // Act
    const result = await data(["push", "games", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain('games  games.0.id  "new-game" has no first-party game origin in src/infra/origins.ts');
  });
});

describe("home layout game tiles against the stored games", () => {
  beforeEach(async () => {
    await store.create(db.getClient().db(DEV), "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
  });

  it("refuses a tile for a game neither listed nor bundled, naming the tile's path and the id, and writes nothing", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    await store.create(dev, "games", fixtures.listedGames(), { by: AUTHOR, now: NOW });
    const { layout, tilePath } = layoutWithGameTile("new-game");
    const file = jsonFile("home-layout.json", layout);

    // Act
    const result = await data(["push", "home-layout", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`home-layout  ${tilePath}  "new-game" is not in games`);
    expect(await store.readDataset(dev, "home-layout")).toBeNull();
  });

  it("refuses a tile for an unbundled game while no games dataset is stored", async () => {
    // Arrange
    const { layout, tilePath } = layoutWithGameTile("new-game");
    const file = jsonFile("home-layout.json", layout);

    // Act
    const result = await data(["push", "home-layout", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`home-layout  ${tilePath}  "new-game" is not in games (no stored dataset)`);
  });

  it.each(["wave-run", "subway-typing", "apple-game", "suika-game"])("accepts a tile for %s, bundled, while no games dataset is stored", async (id) => {
    // Arrange
    const { layout } = layoutWithGameTile(id);
    const file = jsonFile("home-layout.json", layout);

    // Act
    const result = await data(["push", "home-layout", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(0);
  });

  it("accepts a tile for a game the stored games list", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    const listed = fixtures.listedGames();
    listed.games.push({ id: "new-game", entryUrl: "https://new-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 });
    await store.create(dev, "games", listed, { by: AUTHOR, now: NOW });
    const { layout } = layoutWithGameTile("new-game");
    const file = jsonFile("home-layout.json", layout);

    // Act
    const result = await data(["push", "home-layout", "--create", "--file", file]);

    // Assert
    expect(result.code).toBe(0);
  });

  it("refuses a games push that drops a listed game a stored layout names, naming home-layout, and writes nothing", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    const listed = fixtures.listedGames();
    listed.games.push({ id: "new-game", entryUrl: "https://new-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 });
    await store.create(dev, "games", listed, { by: AUTHOR, now: NOW });
    const { layout, tilePath } = layoutWithGameTile("new-game");
    await store.create(dev, "home-layout", layout, { by: AUTHOR, now: NOW });

    // Act
    const result = await pullEditPush("games", () => fixtures.listedGames());

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`home-layout  ${tilePath}  "new-game" is no longer in games`);
    expect((await store.readDataset(dev, "games")).revision).toBe(1);
  });
});
