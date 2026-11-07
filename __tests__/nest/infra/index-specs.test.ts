/**
 * `config/indexes.json` lists the indexes the code creates: every repository's index
 * setup runs against the pinned `mongod`, and each collection's `listIndexes` answer is
 * the file's content. It fails when the two differ; rewrite the file with
 * `INDEXES_WRITE=1 NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/nest/infra/index-specs.test.ts`.
 * A repository that creates indexes must be in REPOSITORIES, which a second test checks.
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "mongodb";
import { MONGOD_START_TIMEOUT_MS, MONGOD_STOP_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { sourceFiles, readSource } from "../../helpers/architecture/tree";

const INDEXES_FILE = path.join(__dirname, "../../../config/indexes.json");
const REWRITE_COMMAND = "INDEXES_WRITE=1 NODE_OPTIONS=--experimental-vm-modules npx jest __tests__/nest/infra/index-specs.test.ts";
const SETUP_TIMEOUT_MS = 30_000;
const DROPPED_FIELDS = ["v", "ns", "2dsphereIndexVersion", "textIndexVersion"];

const REPOSITORIES: Readonly<Record<string, string>> = {
  "src/bus/cache/bus-cache.repository.ts": "BusCacheRepository",
  "src/bus/eta/bus-eta.repository.ts": "BusEtaRepository",
  "src/bus/eta/probe/bus-eta-probe.repository.ts": "BusEtaProbeRepository",
  "src/bus/realtime/hssc/bus-realtime-hssc.repository.ts": "BusRealtimeHsscRepository",
  "src/bus/schedule/bus-schedule.repository.ts": "BusScheduleRepository",
  "src/building/building.repository.ts": "BuildingRepository",
  "src/building/catalog/building-catalog.repository.ts": "BuildingCatalogRepository",
  "src/map/map.repository.ts": "MapRepository",
  "src/miniapps/notifications/miniapps-notifications.repository.ts": "MiniappsNotificationsRepository",
  "src/notices/dispatch/notices-dispatch.repository.ts": "NoticesDispatchRepository",
  "src/notices/list/notices-list.repository.ts": "NoticesListRepository",
  "src/perimeter/perimeter-counters.repository.ts": "PerimeterCountersRepository",
  "src/subway/history/subway-history.repository.ts": "SubwayHistoryRepository",
};

type IndexEntry = { name: string; key: Record<string, unknown> } & Record<string, unknown>;
type IndexList = Record<string, Record<string, IndexEntry[]>>;
type Setup = { onModuleInit(): Promise<void> };

const sortedEntries = <T>(record: Record<string, T>): [string, T][] => Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function toIndexEntry(listed: Record<string, unknown>): IndexEntry {
  const { name, key, ...rest } = listed;
  const kept = Object.fromEntries(sortedEntries(rest as Record<string, unknown>).filter(([field]) => !DROPPED_FIELDS.includes(field)));
  return { name, key, ...kept } as IndexEntry;
}

async function listDb(db: Db): Promise<Record<string, IndexEntry[]>> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = collections.map((collection) => collection.name).filter((name) => !name.startsWith("system."));
  const found: Record<string, IndexEntry[]> = {};
  for (const name of names.sort()) {
    const entries = (await db.collection(name).listIndexes().toArray())
      .filter((listed) => listed.name !== "_id_")
      .map(toIndexEntry)
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    if (entries.length > 0) found[name] = entries;
  }
  return found;
}

describe("toIndexEntry", () => {
  it("drops the version fields and keeps every other option", () => {
    // Arrange
    const listed = {
      v: 2,
      key: { a: 1 },
      name: "a_1",
      unique: true,
      expireAfterSeconds: 60,
      "2dsphereIndexVersion": 3,
      ns: "db.c",
      partialFilterExpression: { x: 1 },
    };

    // Act
    const entry = toIndexEntry(listed);

    // Assert
    expect(JSON.stringify(entry)).toBe(
      JSON.stringify({ name: "a_1", key: { a: 1 }, expireAfterSeconds: 60, partialFilterExpression: { x: 1 }, unique: true }),
    );
  });
});

describe("the repositories that create indexes", () => {
  it("are all in REPOSITORIES", () => {
    // Arrange
    const creators = sourceFiles()
      .filter((file) => !file.endsWith(".spec.ts") && file !== "src/infra/mongo.ts")
      .filter((file) => readSource(file).includes("ensureIndexesAtBoot("));

    // Act & Assert
    expect(creators.sort()).toEqual(Object.keys(REPOSITORIES).sort());
  });
});

describe("config/indexes.json", () => {
  let mongod: TestMongod;
  let generated: IndexList;
  let closeClient: () => Promise<void>;

  beforeAll(async () => {
    mongod = await startMongod();
    const config = require("../../../src/infra/config") as {
      mongo: { url: string; dbName: string };
      building: { dbName: string };
      notices: { dbName: string };
      eventmap: { dbName: string };
      meals: { dbName: string };
      content: { dbName: string };
      miniapps: { dbName: string };
    };
    assertConfigReaches(mongod, config.mongo.url);
    const dbModule = require("../../../src/infra/db") as typeof import("../../../src/infra/db");
    closeClient = dbModule.closeClient;
    const logger = require("../../../src/infra/logger") as { info: unknown; warn: unknown; error: unknown };
    const { envRole } = require("../../../src/infra/required-env") as typeof import("../../../src/infra/required-env");
    expect(envRole(process.env)).not.toBe("api");

    const events: string[] = [];
    const levels = ["info", "warn", "error"] as const;
    const originals = levels.map((level) => logger[level] as (...args: unknown[]) => unknown);
    levels.forEach((level, i) => {
      (logger as Record<string, unknown>)[level] = (obj: unknown, ...rest: unknown[]) => {
        const event = (obj as { event?: string } | null)?.event;
        if (typeof event === "string") events.push(event);
        return originals[i].call(logger, obj, ...rest);
      };
    });
    try {
      const fixedClock = { now: () => new Date(0) };
      const setups = Object.entries(REPOSITORIES).map(([file, className]) => {
        const Repository = (require(path.join("../../..", file)) as Record<string, new (clock: unknown) => Setup>)[className];
        return new Repository(fixedClock);
      });
      await Promise.all(setups.map((setup) => setup.onModuleInit()));
      const deadline = Date.now() + SETUP_TIMEOUT_MS - 5_000;
      const settled = () => events.filter((event) => event.endsWith(".indexes.ensured") || event.endsWith(".indexes.failed")).length;
      while (settled() < setups.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events.filter((event) => event.endsWith(".indexes.failed"))).toEqual([]);
      expect(settled()).toBe(setups.length);
    } finally {
      levels.forEach((level, i) => {
        (logger as Record<string, unknown>)[level] = originals[i];
      });
    }

    const databases: Record<string, string> = {
      MONGO_DB_NAME_BUS_CAMPUS: config.mongo.dbName,
      MONGO_BUILDING_DB_NAME: config.building.dbName,
      MONGO_CONTENT_DB_NAME: config.content.dbName,
      MONGO_EVENTMAP_DB_NAME: config.eventmap.dbName,
      MONGO_MEALS_DB_NAME: config.meals.dbName,
      MONGO_MINIAPPS_DB_NAME: config.miniapps.dbName,
      MONGO_NOTICES_DB_NAME: config.notices.dbName,
    };
    generated = {};
    for (const [envName, dbName] of sortedEntries(databases)) {
      const collections = await listDb(dbModule.getClient().db(dbName));
      if (Object.keys(collections).length > 0) generated[envName] = collections;
    }
  }, MONGOD_START_TIMEOUT_MS + SETUP_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await closeClient?.();
    } finally {
      await mongod?.stop();
    }
  }, MONGOD_STOP_TIMEOUT_MS);

  it("equals the indexes the repositories create", () => {
    // Arrange
    const text = `${JSON.stringify(generated, null, 2)}\n`;
    if (process.env.INDEXES_WRITE === "1") fs.writeFileSync(INDEXES_FILE, text);

    // Act
    const committed = fs.existsSync(INDEXES_FILE) ? fs.readFileSync(INDEXES_FILE, "utf8") : "(missing)";

    // Assert
    const verdict = committed === text ? "in sync" : `config/indexes.json differs from the indexes the code creates. Rewrite it with:\n  ${REWRITE_COMMAND}`;
    expect(verdict).toBe("in sync");
  });
});
