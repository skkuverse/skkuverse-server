/**
 * BusScheduleRepository's driver calls: the pattern and override reads' filters,
 * projections and bound (which FakeBusScheduleRepository follows), the parse
 * that leaves out and logs a document not shaped as the timetable scripts write
 * it, and the boot indexes the scripts' upserts key on.
 */
const toArray = jest.fn();
const find = jest.fn(() => ({ toArray }));
const createIndex = jest.fn().mockResolvedValue("ok");
const mongoCollection = jest.fn(() => ({ find, createIndex }));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);
jest.mock("../../infra/mongo", () => ({
  ...jest.requireActual("../../infra/mongo"),
  mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])),
}));

import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { BusScheduleRepository } from "./bus-schedule.repository";

const PATTERN = { serviceId: "campus-inja", patternId: "weekday", days: [1, 2], entries: [{ time: "08:00" }], effectiveFrom: "2026-08-31" };
const OVERRIDE = { serviceId: "campus-inja", date: "2026-10-21", type: "noService", label: "휴무", notices: [], entries: [] };

beforeEach(() => {
  jest.clearAllMocks();
  toArray.mockResolvedValue([]);
});

describe("BusScheduleRepository.listPatterns", () => {
  it("reads one service's patterns, projected and bounded", async () => {
    // Act
    await new BusScheduleRepository().listPatterns("campus-inja");

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "bus_schedules");
    expect(find).toHaveBeenCalledWith(
      { serviceId: "campus-inja" },
      {
        projection: { _id: 0, serviceId: 1, patternId: 1, days: 1, entries: 1, effectiveFrom: 1, effectiveUntil: 1 },
        maxTimeMS: HOT_READ_MAX_TIME_MS,
      },
    );
  });

  it("serves a stored entry as the same object, and leaves out and logs a broken document", async () => {
    // Arrange
    toArray.mockResolvedValue([PATTERN, { ...PATTERN, patternId: "broken", days: "1,2" }]);

    // Act
    const patterns = await new BusScheduleRepository().listPatterns("campus-inja");

    // Assert
    expect(patterns).toEqual([PATTERN]);
    expect(patterns[0]!.entries[0]).toBe(PATTERN.entries[0]);
    expect(mockLogger.error).toHaveBeenCalledWith(
      { event: "bus.schedule.invalid_document", collection: "bus_schedules", invalid: ["campus-inja/broken: days"] },
      expect.any(String),
    );
  });
});

describe("BusScheduleRepository.listOverrides", () => {
  it("reads one service's overrides from one date to another, projected and bounded", async () => {
    // Arrange
    toArray.mockResolvedValue([OVERRIDE]);

    // Act
    const overrides = await new BusScheduleRepository().listOverrides("campus-inja", "2026-10-19", "2026-10-25");

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.mongo.dbName, "bus_overrides");
    expect(find).toHaveBeenCalledWith(
      { serviceId: "campus-inja", date: { $gte: "2026-10-19", $lte: "2026-10-25" } },
      { projection: { _id: 0, serviceId: 1, date: 1, type: 1, entries: 1, label: 1, notices: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
    expect(overrides).toEqual([OVERRIDE]);
  });
});

describe("BusScheduleRepository.onModuleInit", () => {
  it("creates the unique keys the timetable scripts upsert by", async () => {
    // Act
    await new BusScheduleRepository().onModuleInit();

    // Assert
    expect(createIndex).toHaveBeenCalledWith({ serviceId: 1, patternId: 1 }, { unique: true });
    expect(createIndex).toHaveBeenCalledWith({ serviceId: 1, date: 1 }, { unique: true });
  });

  it("warns (non-fatal) when the index setup rejects", async () => {
    // Arrange
    createIndex.mockRejectedValueOnce(new Error("idx boom"));

    // Act
    await new BusScheduleRepository().onModuleInit();

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "bus.schedule.indexes.failed", err: expect.objectContaining({ message: "idx boom" }) }),
      expect.any(String),
    );
  });
});
