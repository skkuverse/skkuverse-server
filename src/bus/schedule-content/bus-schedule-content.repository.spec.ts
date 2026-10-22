/**
 * BusScheduleContentRepository: the reads of the stored bus schedule content
 * datasets, which `npm run data` writes and the server only parses (ADR 0013,
 * D6).
 *
 * The query object is pinned here, since FakeBusScheduleContentRepository
 * copies it: one document by `_id`, projecting only the revision and the data,
 * bounded by `maxTimeMS`, on the content database's `datasets`. A missing
 * document and one that fails the schema both read as `null`, each logged at
 * error so a person looks, at most once a minute (an invalid one once a minute
 * per revision): the service then serves its last good content or a 503. A
 * failed read rejects as BusScheduleContentReadError.
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
import { BusScheduleContentRepository } from "./bus-schedule-content.repository";

// A copy of revision 1 of the bus-service-notices dataset as stored on 2026-10-19.
const NOTICES_FIXTURE = path.join(__dirname, "../../../__tests__/nest/bus/fixtures/bus-service-notices.dataset.json");
const NOTICES = JSON.parse(fs.readFileSync(NOTICES_FIXTURE, "utf8")) as Record<string, unknown>;
delete NOTICES._about;

// A copy of revision 1 of the skku-rest-days dataset as stored on 2026-10-19.
const REST_DAYS_FIXTURE = path.join(__dirname, "../../../__tests__/nest/bus/fixtures/skku-rest-days.dataset.json");
const REST_DAYS = JSON.parse(fs.readFileSync(REST_DAYS_FIXTURE, "utf8")) as Record<string, string>;
delete REST_DAYS._about;

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

describe("BusScheduleContentRepository.findServiceNotices", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "bus-service-notices", revision: 4, data: NOTICES });

    // Act
    await new BusScheduleContentRepository().findServiceNotices();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "bus-service-notices" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed services", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "bus-service-notices", revision: 4, data: NOTICES });

    // Act
    const stored = await new BusScheduleContentRepository().findServiceNotices();

    // Assert
    expect(stored).toEqual({ revision: 4, services: NOTICES.services });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new BusScheduleContentRepository().findServiceNotices();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.service_notices.missing", dataset: "bus-service-notices" });
  });

  it("returns null for a document that fails the schema, logged at error with its revision and issues", async () => {
    // Arrange
    const services = structuredClone(NOTICES.services) as Record<string, { notices: Array<{ style: string }> }>;
    services["campus-inja"]!.notices[0]!.style = "warnig";
    findOne.mockResolvedValue({ _id: "bus-service-notices", revision: 6, data: { services } });

    // Act
    const stored = await new BusScheduleContentRepository().findServiceNotices();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.service_notices.invalid", revision: 6 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.services\.campus-inja\.notices\.0\.style: /);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "bus-service-notices", data: NOTICES });

    // Act
    const stored = await new BusScheduleContentRepository().findServiceNotices();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.service_notices.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("rejects a failing read as BusScheduleContentReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new BusScheduleContentRepository().findServiceNotices()).rejects.toMatchObject({ name: "BusScheduleContentReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new BusScheduleContentRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findServiceNotices();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findServiceNotices();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "bus.service_notices.missing", suppressed: 0 }),
      expect.objectContaining({ event: "bus.service_notices.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new BusScheduleContentRepository();
    findOne.mockResolvedValue({ _id: "bus-service-notices", revision: 6, data: { ...NOTICES, extra: 1 } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findServiceNotices();
    findOne.mockResolvedValue({ _id: "bus-service-notices", revision: 7, data: { ...NOTICES, extra: 1 } });
    await fresh.findServiceNotices();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "bus.service_notices.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "bus.service_notices.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});

describe("BusScheduleContentRepository.findRestDays", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 2, data: REST_DAYS });

    // Act
    await new BusScheduleContentRepository().findRestDays();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "skku-rest-days" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the rest days, yearly and one-off", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 2, data: { ...REST_DAYS, "2027-03-02": "학사휴교" } });

    // Act
    const stored = await new BusScheduleContentRepository().findRestDays();

    // Assert
    expect(stored).toEqual({
      revision: 2,
      restDays: { exact: new Map([["2027-03-02", "학사휴교"]]), annual: new Map([["09-25", "건학기념일"], ["09-28", "공자탄신일"]]) },
    });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new BusScheduleContentRepository().findRestDays();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.rest_days.missing", dataset: "skku-rest-days" });
  });

  it("returns null for a document that fails the schema, logged at error with its revision and the key", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "skku-rest-days", revision: 3, data: { ...REST_DAYS, "02-30": "휴일" } });

    // Act
    const stored = await new BusScheduleContentRepository().findRestDays();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.rest_days.invalid", revision: 3 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.02-30: /);
  });

  it("logs a missing rest days dataset apart from missing service notices", async () => {
    // Arrange
    const fresh = new BusScheduleContentRepository();
    findOne.mockResolvedValue(null);

    // Act
    await fresh.findServiceNotices();
    await fresh.findRestDays();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields.event)).toEqual(["bus.service_notices.missing", "bus.rest_days.missing"]);
  });

  it("rejects a failing read as BusScheduleContentReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new BusScheduleContentRepository().findRestDays()).rejects.toMatchObject({ name: "BusScheduleContentReadError", cause: failure });
  });
});
