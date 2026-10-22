/**
 * The Idempotency-Key claim against a real `mongod` (ADR 0011, D6): the unique
 * partial index MiniappsNotificationsRepository ensures where pollers run is
 * what lets one of two concurrent sends with the same key claim it, so the
 * Cloud Function is called once. Guarded here: a second claim of a key within
 * one mini app loses, however many race; the same key under another mini app
 * and rows without a key are never refused; the lookup reads the claimed row,
 * through the unique index rather than the feed index.
 *
 * The repository comes from a Nest testing module booted as the poller, which
 * is the role that creates the index (ADR 0012, D3).
 */
import type { Collection } from "mongodb";
import { Test, type TestingModule } from "@nestjs/testing";
import type { SentNotificationDoc } from "../../../src/miniapps/miniapps.document";
import type { MiniappsNotificationsRepository } from "../../../src/miniapps/notifications/miniapps-notifications.repository";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";

type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type RepositoryModule = typeof import("../../../src/miniapps/notifications/miniapps-notifications.repository");

const INDEX_NAME = "miniAppId_idempotencyKey_unique";
const INDEX_WAIT_MS = 5_000;

let mongod: TestMongod;
let db: Db;
let testingModule: TestingModule;
let repository: MiniappsNotificationsRepository;
let sentNotifications: Collection<SentNotificationDoc>;

function row(id: string, miniAppId: string, idempotencyKey?: string): SentNotificationDoc {
  return {
    _id: id,
    miniAppId,
    title_ko: "안내",
    body_ko: "본문",
    title_en: null,
    body_en: null,
    sentAt: new Date("2026-10-22T03:00:00.000Z"),
    delivery: null,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

// WHY: ensureIndexesAtBoot holds the boot for one turn only, so the index may still be building when init returns.
async function waitForIndex(): Promise<void> {
  const deadline = Date.now() + INDEX_WAIT_MS;
  while (Date.now() < deadline) {
    const indexes = await sentNotifications.indexes().catch(() => []);
    if (indexes.some((index) => index.name === INDEX_NAME)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${INDEX_NAME} was not created within ${INDEX_WAIT_MS} ms`);
}

async function uniqueIndexAccesses(): Promise<number> {
  const stats = await sentNotifications.aggregate<{ name: string; accesses: { ops: number } }>([{ $indexStats: {} }]).toArray();
  return Number(stats.find((index) => index.name === INDEX_NAME)?.accesses.ops ?? 0);
}

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  const config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  sentNotifications = db.getClient().db(config.miniapps.dbName).collection(config.miniapps.collections.sentNotifications);
  const { MiniappsNotificationsRepository: Repository } = require("../../../src/miniapps/notifications/miniapps-notifications.repository") as RepositoryModule;
  const previousRole = process.env.ROLE;
  process.env.ROLE = "poller";
  try {
    testingModule = await Test.createTestingModule({ providers: [Repository] }).compile();
    await testingModule.init();
    repository = testingModule.get(Repository);
    await waitForIndex();
  } finally {
    if (previousRole === undefined) delete process.env.ROLE;
    else process.env.ROLE = previousRole;
  }
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await testingModule?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  await sentNotifications.deleteMany({});
});

describe("MiniappsNotificationsRepository.claimSentNotification over the unique index", () => {
  it("lets the first claim of a key win and refuses the second, storing one row", async () => {
    // Arrange
    await repository.claimSentNotification(row("n1", "hssc", "retry-1"));

    // Act
    const second = await repository.claimSentNotification(row("n2", "hssc", "retry-1"));

    // Assert
    expect(second).toBe(false);
    expect(await sentNotifications.find({}).map((doc) => doc._id).toArray()).toEqual(["n1"]);
  });

  it("lets exactly one of many concurrent claims of a key win", async () => {
    // Act
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) => repository.claimSentNotification(row(`n${index}`, "hssc", "retry-2"))),
    );

    // Assert
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await sentNotifications.countDocuments({ idempotencyKey: "retry-2" })).toBe(1);
  });

  it("claims the same key under another mini app", async () => {
    // Arrange
    await repository.claimSentNotification(row("n1", "hssc", "retry-3"));

    // Act
    const other = await repository.claimSentNotification(row("n2", "nsc", "retry-3"));

    // Assert
    expect(other).toBe(true);
  });

  it("never refuses rows without a key", async () => {
    // Act
    await repository.insertSentNotification(row("n1", "hssc"));
    await repository.insertSentNotification(row("n2", "hssc"));

    // Assert
    expect(await sentNotifications.countDocuments({ miniAppId: "hssc" })).toBe(2);
  });
});

describe("MiniappsNotificationsRepository.findSentNotificationByIdempotencyKey over mongod", () => {
  it("reads the row that claimed the key in that mini app, and null for another mini app", async () => {
    // Arrange
    await repository.claimSentNotification(row("n1", "hssc", "retry-4"));

    // Act
    const found = await repository.findSentNotificationByIdempotencyKey("hssc", "retry-4");
    const elsewhere = await repository.findSentNotificationByIdempotencyKey("nsc", "retry-4");

    // Assert
    expect(found?._id).toBe("n1");
    expect(elsewhere).toBeNull();
  });

  it("is served by the unique index", async () => {
    // Arrange
    // The planner uses a partial index only for a filter it can prove lies inside the index's own filter.
    await repository.claimSentNotification(row("n1", "hssc", "retry-5"));
    await repository.insertSentNotification(row("n2", "hssc"));
    const before = await uniqueIndexAccesses();

    // Act
    await repository.findSentNotificationByIdempotencyKey("hssc", "retry-5");

    // Assert
    expect((await uniqueIndexAccesses()) - before).toBe(1);
  });
});
