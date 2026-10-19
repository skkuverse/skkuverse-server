/**
 * UiHomeRepository: the read of the stored `home-layout` dataset, which
 * `npm run data` writes and the server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeUiHomeRepository copies it: one
 * document by `_id`, projecting only the revision and the data, bounded by
 * `maxTimeMS`, on the content database's `datasets`. A missing document and
 * one that fails the schema both read as `null`, each logged at error so a
 * person looks, at most once a minute (an invalid one once a minute per
 * revision): the service then serves its last good layout or a 503. A failed
 * read rejects as UiHomeLayoutReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and
 * src/infra/logger.ts are mocked.
 */
import fs from "fs";
import path from "path";

const findOne = jest.fn();
const openedCollections: Array<{ dbName: string; name: string }> = [];

jest.mock("../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../infra/db").HOT_READ_MAX_TIME_MS,
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
jest.mock("../../infra/logger", () => mockLogger);

import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { logText } from "../../../__tests__/helpers/log-text";
import { UiHomeRepository } from "./ui-home.repository";

// The committed home-layout.json, kept as the fixture the dataset is seeded from.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/home-layout.dataset.json");
const LAYOUT = JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as Record<string, unknown>;
delete LAYOUT._about;

const repository = new UiHomeRepository();
const NOW = new Date("2026-10-19T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
});

describe("UiHomeRepository.findHomeLayout", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "home-layout", revision: 4, data: LAYOUT });

    // Act
    await repository.findHomeLayout();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "home-layout" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed layout", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "home-layout", revision: 4, data: LAYOUT });

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(stored).toEqual({ revision: 4, layout: LAYOUT });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "ui.home_layout.missing" });
  });

  it("returns null for a document that fails the schema, logged at error with its revision and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "home-layout", revision: 6, data: { ...LAYOUT, extra: 1 } });

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "ui.home_layout.invalid", revision: 6 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data: .*extra/);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "home-layout", data: LAYOUT });

    // Act
    const stored = await repository.findHomeLayout();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "ui.home_layout.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("lets a failing read reject, so the loader keeps its last good layout", async () => {
    // Arrange
    findOne.mockRejectedValue(new Error("server selection timed out"));

    // Act & Assert
    await expect(repository.findHomeLayout()).rejects.toThrow("server selection timed out");
  });

  it("rejects a failing read as UiHomeLayoutReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(repository.findHomeLayout()).rejects.toMatchObject({ name: "UiHomeLayoutReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new UiHomeRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findHomeLayout();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findHomeLayout();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "ui.home_layout.missing", suppressed: 0 }),
      expect.objectContaining({ event: "ui.home_layout.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new UiHomeRepository();
    findOne.mockResolvedValue({ _id: "home-layout", revision: 6, data: { ...LAYOUT, extra: 1 } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findHomeLayout();
    findOne.mockResolvedValue({ _id: "home-layout", revision: 7, data: { ...LAYOUT, extra: 1 } });
    await fresh.findHomeLayout();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "ui.home_layout.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "ui.home_layout.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
