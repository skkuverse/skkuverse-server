/**
 * The `miniapps` dataset's round trip between its one writer and its reader,
 * over a real `mongod` (move-miniapp-registry task 10.3; design D2, D6; ADR
 * 0013, D3 and D6): what `npm run data` stores through
 * scripts/lib/datasets/store.js, MiniappsRepository reads back parsed as the
 * server parses it (an unset shell logo filled from the home logo), at the
 * stored revision.
 *
 * And the cross-references a push keeps, run through the tool itself
 * (scripts/data.js over the catalog loaded from `src/`) against the `_dev`
 * and production content databases of one `mongod`:
 *   - a `miniapps` push that drops a mini app the stored home layout names is
 *     refused, naming `home-layout`, the tile's path and the id;
 *   - a home layout that places a mini app only `_dev`'s registry holds is
 *     stored in `_dev` and refused in production, naming the tile's path and
 *     the id: each push is checked against its own database's registry.
 *
 * The writer is the tool's own store module, not a copy of its document shape,
 * so a change to how the tool stores a dataset that the reader does not follow
 * fails here. The repository comes from a Nest testing module, as the app
 * builds it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db as MongoDb } from "mongodb";
import { Test } from "@nestjs/testing";
import type { MiniappsRepository } from "../../../src/miniapps/miniapps.repository";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");
const { run } = require("../../../scripts/data");

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/miniapps/miniapps.repository");
type RegistryFixture = typeof import("../../helpers/miniapps/registry-fixture");
type SchemaModule = typeof import("../../../src/miniapps/miniapps.schema");
type Registry = ReturnType<RegistryFixture["fixtureRegistry"]>;
type Layout = { sections: Array<{ type: string; tiles?: Array<Record<string, unknown>> }> };

const NOW = new Date("2026-10-20T03:00:00.000Z");
const AUTHOR = "alice@example.com";
const BASE = "skku_content";
const DEV = "skku_content_dev";
const REPO = path.join(__dirname, "../../..");
const srcLoader = (relativePath: string): unknown => require(path.join(REPO, "src", relativePath));

function fixtureLayout(): Layout {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "../ui/fixtures/home-layout.dataset.json"), "utf8")) as Layout & { _about?: string };
  delete layout._about;
  return layout;
}

/** The fixture layout with a `miniapp` tile `id` at the end of its grid, and that tile's id path. */
function layoutWithTile(id: string): { layout: Layout; tilePath: string } {
  const layout = fixtureLayout();
  const grid = layout.sections.findIndex((section) => section.type === "tile_grid");
  // The game tile wave-run gives way: tile ids are one namespace.
  const tiles = layout.sections[grid]!.tiles!.filter((tile) => tile.id !== id);
  tiles.push({ kind: "miniapp", id });
  layout.sections[grid]!.tiles = tiles;
  return { layout, tilePath: `sections.${grid}.tiles.${tiles.length - 1}.id` };
}

let mongod: TestMongod;
let db: Db;
let content: MongoDb;
let repository: MiniappsRepository;
let registries: RegistryFixture;
let schema: SchemaModule;
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

/** Pulls `dataset` from the target, edits its working file with `edit`, and pushes it back. */
async function pullEditPush(dataset: string, edit: (data: never) => unknown, flags: string[] = []): Promise<{ code: number; out: string; err: string }> {
  await data(["pull", dataset, ...flags]);
  const file = path.join(root, ".data", flags.includes("--prod") ? "prod" : "dev", `${dataset}.json`);
  const working = JSON.parse(fs.readFileSync(file, "utf8")) as { data: never };
  working.data = edit(working.data) as never;
  fs.writeFileSync(file, JSON.stringify(working, null, 2));
  return data(["push", dataset, ...flags]);
}

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  content = db.getClient().db(config.content.dbName);
  registries = require("../../helpers/miniapps/registry-fixture") as RegistryFixture;
  schema = require("../../../src/miniapps/miniapps.schema") as SchemaModule;
  const { MiniappsRepository: Repository } = require("../../../src/miniapps/miniapps.repository") as RepositoryModule;
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "miniapps-dataset-"));
  await clearCollections(content);
  await db.getClient().db(DEV).dropDatabase();
  await db.getClient().db(BASE).dropDatabase();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("a mini app registry stored by npm run data, read by MiniappsRepository", () => {
  it("reads back the pushed registry, parsed as the server parses it, at its revision", async () => {
    // Arrange
    const pushed = registries.fixtureRegistryWithWaveRun();
    await store.create(content, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
    const result = await store.push(content, "miniapps", pushed, { baseRevision: 1, by: AUTHOR, now: NOW });

    // Act
    const stored = await repository.findRegistry();

    // Assert
    expect(result).toMatchObject({ ok: true, revision: 2 });
    expect(stored).toEqual({ revision: 2, registry: schema.checkedRegistry.parse(pushed) });
  });

  it("creates revision 1 from the fixture through the tool, which its checks accept", async () => {
    // Arrange
    const file = path.join(root, "miniapps.json");
    fs.writeFileSync(file, JSON.stringify(registries.fixtureRegistry()));

    // Act
    const result = await data(["push", "miniapps", "--create", "--file", file, "--note", "import"]);

    // Assert
    expect(result.code).toBe(0);
    expect(await store.readDataset(db.getClient().db(DEV), "miniapps")).toMatchObject({ revision: 1, data: registries.fixtureRegistry() });
  });
});

describe("a miniapps push that drops a mini app the stored home layout names", () => {
  it("is refused, naming home-layout, the tile's path and the id, and writes nothing", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    const { layout, tilePath } = layoutWithTile("mukja");
    await store.create(dev, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
    await store.create(dev, "home-layout", layout, { by: AUTHOR, now: NOW });

    // Act
    const result = await pullEditPush("miniapps", (registry: Registry) => {
      registry.index.miniApps = registry.index.miniApps.filter((entry) => entry.id !== "mukja");
      delete registry.details.mukja;
      return registry;
    });

    // Assert
    expect(result.code).toBe(1);
    expect(result.err).toContain(`home-layout  ${tilePath}  "mukja" is no longer in miniapps`);
    expect((await store.readDataset(dev, "miniapps")).revision).toBe(1);
  });
});

describe("a home layout pushed to two databases whose registries differ", () => {
  it("is stored where the registry holds its tile and refused where it does not, naming the tile's path and the id", async () => {
    // Arrange
    const dev = db.getClient().db(DEV);
    const prod = db.getClient().db(BASE);
    await store.create(dev, "miniapps", registries.fixtureRegistryWithWaveRun(), { by: AUTHOR, now: NOW });
    await store.create(prod, "miniapps", registries.fixtureRegistry(), { by: AUTHOR, now: NOW });
    await store.create(dev, "home-layout", fixtureLayout(), { by: AUTHOR, now: NOW });
    await store.create(prod, "home-layout", fixtureLayout(), { by: AUTHOR, now: NOW });
    const { layout, tilePath } = layoutWithTile("wave-run");

    // Act
    const toDevelopment = await pullEditPush("home-layout", () => layout);
    const toProduction = await pullEditPush("home-layout", () => layout, ["--prod", "--yes"]);

    // Assert
    expect(toDevelopment.code).toBe(0);
    expect((await store.readDataset(dev, "home-layout")).revision).toBe(2);
    expect(toProduction.code).toBe(1);
    expect(toProduction.err).toMatch(new RegExp(`home-layout  ${tilePath.replace(/\./g, "\\.")}  .*wave-run`));
    expect((await store.readDataset(prod, "home-layout")).revision).toBe(1);
  });
});
