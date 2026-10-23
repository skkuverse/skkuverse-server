/**
 * AppConfigRepository: the read of the stored `app-features` dataset, which `npm run data` writes and the server
 * only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeAppConfigRepository copies it: one document by `_id`, projecting only
 * the revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A missing document and
 * one that fails the schema both read as `null`, each logged at error so a person looks, at most once a minute (an
 * invalid one once a minute per revision): /app/config then keeps its last good value, or serves the switches off.
 * A failed read rejects as AppConfigFeaturesReadError.
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

describe("AppConfigRepository.findFeatures", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "app-features", revision: 2, data: { sharedMapShell: true } });

    // Act
    await new AppConfigRepository().findFeatures();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "app-features" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed features", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "app-features", revision: 2, data: { sharedMapShell: true } });

    // Act
    const stored = await new AppConfigRepository().findFeatures();

    // Assert
    expect(stored).toEqual({ revision: 2, data: { sharedMapShell: true } });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as app_config.features.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new AppConfigRepository().findFeatures();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "app_config.features.missing", dataset: "app-features" });
  });

  it("returns null for a document that fails the schema, logged at error as app_config.features.invalid with its revision and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "app-features", revision: 5, data: { sharedMapShell: "true" } });

    // Act
    const stored = await new AppConfigRepository().findFeatures();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "app_config.features.invalid", dataset: "app-features", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.sharedMapShell: Invalid input: expected boolean/);
  });

  it("rejects a failing read as AppConfigFeaturesReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new AppConfigRepository().findFeatures()).rejects.toMatchObject({ name: "AppConfigFeaturesReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new AppConfigRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findFeatures();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findFeatures();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "app_config.features.missing", suppressed: 0 }),
      expect.objectContaining({ event: "app_config.features.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new AppConfigRepository();
    findOne.mockResolvedValue({ _id: "app-features", revision: 6, data: {} });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findFeatures();
    findOne.mockResolvedValue({ _id: "app-features", revision: 7, data: {} });
    await fresh.findFeatures();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "app_config.features.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "app_config.features.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
