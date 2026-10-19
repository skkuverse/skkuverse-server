/**
 * UiCampusRepository: the read of the stored `campus-banners` dataset, which
 * `npm run data` writes and the server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeUiCampusRepository copies it: one
 * document by `_id`, projecting only the revision and the data, bounded by
 * `maxTimeMS`, on the content database's `datasets`. A missing document and
 * one that fails the schema both read as `null`, each logged at error so a
 * person looks, at most once a minute (an invalid one once a minute per
 * revision): the service then serves its last good banners or a 503. A failed
 * read rejects as UiCampusBannersReadError.
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
import { UiCampusRepository } from "./ui-campus.repository";

// A copy of revision 1 of the campus-banners dataset, the committed file at 5c0ee5a9.
const DATASET_FIXTURE = path.join(__dirname, "../../../__tests__/nest/ui/fixtures/campus-banners.dataset.json");
const BANNERS = JSON.parse(fs.readFileSync(DATASET_FIXTURE, "utf8")) as Record<string, unknown>;
delete BANNERS._about;

const repository = new UiCampusRepository();
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

describe("UiCampusRepository.findCampusBanners", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "campus-banners", revision: 4, data: BANNERS });

    // Act
    await repository.findCampusBanners();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "campus-banners" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed banners", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "campus-banners", revision: 4, data: BANNERS });

    // Act
    const stored = await repository.findCampusBanners();

    // Assert
    expect(stored).toEqual({ revision: 4, banners: BANNERS });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await repository.findCampusBanners();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "ui.campus_banners.missing" });
  });

  it("returns null for a document that fails the schema, logged at error with its revision and issues", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "campus-banners", revision: 6, data: { ...BANNERS, extra: 1 } });

    // Act
    const stored = await repository.findCampusBanners();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "ui.campus_banners.invalid", revision: 6 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data: .*extra/);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "campus-banners", data: BANNERS });

    // Act
    const stored = await repository.findCampusBanners();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "ui.campus_banners.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("lets a failing read reject, so the loader keeps its last good banners", async () => {
    // Arrange
    findOne.mockRejectedValue(new Error("server selection timed out"));

    // Act & Assert
    await expect(repository.findCampusBanners()).rejects.toThrow("server selection timed out");
  });

  it("rejects a failing read as UiCampusBannersReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(repository.findCampusBanners()).rejects.toMatchObject({ name: "UiCampusBannersReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new UiCampusRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findCampusBanners();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findCampusBanners();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "ui.campus_banners.missing", suppressed: 0 }),
      expect.objectContaining({ event: "ui.campus_banners.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new UiCampusRepository();
    findOne.mockResolvedValue({ _id: "campus-banners", revision: 6, data: { ...BANNERS, extra: 1 } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findCampusBanners();
    findOne.mockResolvedValue({ _id: "campus-banners", revision: 7, data: { ...BANNERS, extra: 1 } });
    await fresh.findCampusBanners();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "ui.campus_banners.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "ui.campus_banners.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
