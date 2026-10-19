/**
 * An api replica writes nothing at boot (ADR 0012, D3; isolate-api-from-pollers
 * spec "An api replica writes no data at boot"): booted with ROLE=api on an
 * empty `mongod`, every module `src/app.module.ts` imports leaves the server
 * with no database, so no document, index or collection, and no seed. A poller
 * booted the same way ensures the indexes its repositories declare, which shows
 * the check can see a boot write within the same wait.
 *
 * Only `Clock` is overridden. The poller boot runs under a spy on
 * PollerRegistryService#registerPoller that registers nothing, so no tick calls
 * an upstream. The mini app manifest prefetch, the one boot fetch api keeps
 * (ADR 0012, D2), answers 404 from a stubbed `fetch`; any other upstream call
 * fails the test through the network guard.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { MongoClient } from "mongodb";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];

const CLOCK = { now: (): Date => new Date("2026-10-20T01:00:00Z") };
const SYSTEM_DATABASES = new Set(["admin", "config", "local"]);
// WHY: an index setup still running when the boot returns finishes in the background (src/infra/mongo.ts).
const SETTLE_MS = 1_000;

let mongod: TestMongod;
let db: Db;
let config: Config;
let buildTestApp: BuildTestApp;
let PollerRegistryService: Registry;
let app: NestExpressApplication | undefined;
const realFetch = global.fetch;
const fetched: string[] = [];

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;
  PollerRegistryService = (require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry })
    .PollerRegistryService;
  global.fetch = (async (input: string | URL | Request) => {
    fetched.push(String(input));
    return new Response("", { status: 404 });
  }) as typeof fetch;
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  global.fetch = realFetch;
  try {
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  fetched.length = 0;
  for (const name of await userDatabases(db.getClient())) await db.getClient().db(name).dropDatabase();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

async function userDatabases(client: MongoClient): Promise<string[]> {
  const { databases } = await client.db("admin").admin().listDatabases({ nameOnly: true });
  return databases.map((d) => d.name).filter((name) => !SYSTEM_DATABASES.has(name));
}

async function bootAndSettle(role: "api" | "poller"): Promise<void> {
  jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation(() => undefined);
  app = await buildTestApp({
    imports: appModulesUnder("src/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role,
  });
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

describe("booting every module on an empty database", () => {
  it("as an api replica creates no database, so no document, index or collection", async () => {
    // Act
    await bootAndSettle("api");

    // Assert
    expect(await userDatabases(db.getClient())).toEqual([]);
    expect(fetched.every((url) => url.endsWith("/skkuverse.json"))).toBe(true);
  }, APP_BOOT_TIMEOUT_MS);

  it("as the poller ensures the indexes the repositories declare", async () => {
    // Act
    await bootAndSettle("poller");

    // Assert
    const busCacheIndexes = await db.getClient().db(config.mongo.dbName).collection(config.mongo.collections.busCache).indexes();
    expect(busCacheIndexes.map((index) => index.name)).toEqual(expect.arrayContaining(["_id_", expect.not.stringMatching(/^_id_$/)]));
    expect(await userDatabases(db.getClient())).toEqual(expect.arrayContaining([config.mongo.dbName, config.notices.dbName]));
  }, APP_BOOT_TIMEOUT_MS);
});
