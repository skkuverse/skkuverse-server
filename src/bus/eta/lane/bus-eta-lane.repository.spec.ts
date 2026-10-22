/**
 * BusEtaLaneRepository: the read of the stored `bus-lane-corridor` dataset, which `npm run data` writes and the
 * server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeBusEtaLaneRepository copies it: one document by `_id`, projecting only
 * the revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A missing document and
 * one that fails the schema both read as `null`, each logged at error so a person looks, at most once a minute (an
 * invalid one once a minute per revision): the live tick then keeps its last good corridor or falls back to the car
 * model. A failed read rejects as BusEtaLaneReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and src/infra/logger.ts are mocked.
 */
const findOne = jest.fn();
const openedCollections: Array<{ dbName: string; name: string }> = [];

jest.mock("../../../infra/db", () => ({
  HOT_READ_MAX_TIME_MS: jest.requireActual("../../../infra/db").HOT_READ_MAX_TIME_MS,
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
jest.mock("../../../infra/logger", () => mockLogger);

import { corridorFixture } from "../../../../__tests__/helpers/bus/bus-lane-corridor";
import { logText } from "../../../../__tests__/helpers/log-text";
import config from "../../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../../infra/db";
import { BusEtaLaneRepository } from "./bus-eta-lane.repository";

const NOW = new Date("2026-10-20T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
});

describe("BusEtaLaneRepository.findCorridor", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "bus-lane-corridor", revision: 2, data: corridorFixture() });

    // Act
    await new BusEtaLaneRepository().findCorridor();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "bus-lane-corridor" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed corridor", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "bus-lane-corridor", revision: 2, data: corridorFixture() });

    // Act
    const stored = await new BusEtaLaneRepository().findCorridor();

    // Assert
    expect(stored).toEqual({ revision: 2, data: corridorFixture() });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as bus.lane_corridor.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new BusEtaLaneRepository().findCorridor();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.lane_corridor.missing", dataset: "bus-lane-corridor" });
  });

  it("returns null for a document that fails the schema, logged at error as bus.lane_corridor.invalid with its revision and issues", async () => {
    // Arrange
    const data = corridorFixture() as unknown as { probeRoutes: Array<{ routeId: string }> };
    data.probeRoutes[1]!.routeId = "G5000";
    findOne.mockResolvedValue({ _id: "bus-lane-corridor", revision: 5, data });

    // Act
    const stored = await new BusEtaLaneRepository().findCorridor();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.lane_corridor.invalid", dataset: "bus-lane-corridor", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.probeRoutes\.1\.routeId: /);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "bus-lane-corridor", data: corridorFixture() });

    // Act
    const stored = await new BusEtaLaneRepository().findCorridor();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.lane_corridor.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("rejects a failing read as BusEtaLaneReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new BusEtaLaneRepository().findCorridor()).rejects.toMatchObject({ name: "BusEtaLaneReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new BusEtaLaneRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findCorridor();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findCorridor();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "bus.lane_corridor.missing", suppressed: 0 }),
      expect.objectContaining({ event: "bus.lane_corridor.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new BusEtaLaneRepository();
    findOne.mockResolvedValue({ _id: "bus-lane-corridor", revision: 6, data: { ...corridorFixture(), laneHours: {} } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findCorridor();
    findOne.mockResolvedValue({ _id: "bus-lane-corridor", revision: 7, data: { ...corridorFixture(), laneHours: {} } });
    await fresh.findCorridor();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "bus.lane_corridor.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "bus.lane_corridor.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
