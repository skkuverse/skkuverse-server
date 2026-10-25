/**
 * AppConfigRepository: the read of the stored `app-platform-gates` dataset, which `npm run data` writes and the
 * server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeAppConfigRepository copies it: one document by `_id`, projecting only
 * the revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A missing document and
 * one that fails the schema both read as `null`, each logged at error so a person looks, at most once a minute (an
 * invalid one once a minute per revision): /app/config then keeps its last good value, or answers 503.
 * A failed read rejects as AppConfigPlatformGatesReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and src/infra/logger.ts are mocked.
 */
const findOne = jest.fn();
const openedCollections: Array<{ dbName: string; name: string }> = [];

jest.mock("../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../infra/db").HOT_READ_MAX_TIME_MS,
  getClient: jest.fn(() => ({
    db: (dbName: string) => ({
      collection: (name: string) => {
        openedCollections.push({ dbName, name });
        return { findOne };
      },
    }),
  })),
}));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../infra/logger", () => mockLogger);

import { appPlatformGatesFixture } from "../../__tests__/helpers/app-config/app-platform-gates";
import { logText } from "../../__tests__/helpers/log-text";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { AppConfigRepository } from "./app-config.repository";

const NOW = new Date("2026-10-23T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
});

describe("AppConfigRepository.findPlatformGates", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "app-platform-gates", revision: 2, data: appPlatformGatesFixture() });

    // Act
    await new AppConfigRepository().findPlatformGates();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "app-platform-gates" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed platform gates", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "app-platform-gates", revision: 2, data: appPlatformGatesFixture() });

    // Act
    const stored = await new AppConfigRepository().findPlatformGates();

    // Assert
    expect(stored).toEqual({ revision: 2, data: appPlatformGatesFixture() });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as app_config.platform_gates.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new AppConfigRepository().findPlatformGates();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "app_config.platform_gates.missing", dataset: "app-platform-gates" });
  });

  it("returns null for a document that fails the schema, logged at error as app_config.platform_gates.invalid with its revision and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "app-platform-gates", revision: 5, data: { ...appPlatformGatesFixture(), ios: { ...appPlatformGatesFixture().ios, minVersion: "3.6" } } });

    // Act
    const stored = await new AppConfigRepository().findPlatformGates();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "app_config.platform_gates.invalid", dataset: "app-platform-gates", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.ios\.minVersion: /);
  });

  it("rejects a failing read as AppConfigPlatformGatesReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new AppConfigRepository().findPlatformGates()).rejects.toMatchObject({ name: "AppConfigPlatformGatesReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new AppConfigRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findPlatformGates();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findPlatformGates();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "app_config.platform_gates.missing", suppressed: 0 }),
      expect.objectContaining({ event: "app_config.platform_gates.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new AppConfigRepository();
    findOne.mockResolvedValue({ _id: "app-platform-gates", revision: 6, data: {} });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findPlatformGates();
    findOne.mockResolvedValue({ _id: "app-platform-gates", revision: 7, data: {} });
    await fresh.findPlatformGates();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "app_config.platform_gates.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "app_config.platform_gates.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
