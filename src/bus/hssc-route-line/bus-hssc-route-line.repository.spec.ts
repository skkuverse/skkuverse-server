/**
 * BusHsscRouteLineRepository: the read of the stored `hssc-route-line` dataset, which `npm run data` writes and the
 * server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeBusHsscRouteLineRepository copies it: one document by `_id`, projecting
 * only the revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A missing document
 * and one that fails the schema both read as `null`, each logged at error at most once a minute (an invalid one once
 * a minute per revision): the map then serves the Jongno lines without the HSSC line. A failed read rejects as
 * BusHsscRouteLineReadError.
 *
 * src/infra/db.ts (whose client src/infra/mongo.ts opens collections on) and src/infra/logger.ts are mocked.
 */
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

import { hsscRouteLineFixture } from "../../../__tests__/helpers/bus/hssc-route-line";
import { logText } from "../../../__tests__/helpers/log-text";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { BusHsscRouteLineRepository } from "./bus-hssc-route-line.repository";

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

describe("BusHsscRouteLineRepository.findRouteLine", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "hssc-route-line", revision: 1, data: hsscRouteLineFixture() });

    // Act
    await new BusHsscRouteLineRepository().findRouteLine();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "hssc-route-line" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed line", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "hssc-route-line", revision: 3, data: hsscRouteLineFixture() });

    // Act
    const stored = await new BusHsscRouteLineRepository().findRouteLine();

    // Assert
    expect(stored).toEqual({ revision: 3, data: hsscRouteLineFixture() });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as bus.hssc_route_line.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new BusHsscRouteLineRepository().findRouteLine();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.hssc_route_line.missing", dataset: "hssc-route-line" });
  });

  it("returns null for a document that fails the schema, logged at error as bus.hssc_route_line.invalid with its revision and issues", async () => {
    // Arrange
    const data = hsscRouteLineFixture();
    data.path[4] = [37.587807, 126.992374];
    findOne.mockResolvedValue({ _id: "hssc-route-line", revision: 5, data });

    // Act
    const stored = await new BusHsscRouteLineRepository().findRouteLine();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "bus.hssc_route_line.invalid", dataset: "hssc-route-line", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.path\.4\.1: /);
  });

  it("rejects a failing read as BusHsscRouteLineReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new BusHsscRouteLineRepository().findRouteLine()).rejects.toMatchObject({ name: "BusHsscRouteLineReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new BusHsscRouteLineRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findRouteLine();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findRouteLine();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "bus.hssc_route_line.missing", suppressed: 0 }),
      expect.objectContaining({ event: "bus.hssc_route_line.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new BusHsscRouteLineRepository();
    findOne.mockResolvedValue({ _id: "hssc-route-line", revision: 6, data: { path: "none" } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findRouteLine();
    findOne.mockResolvedValue({ _id: "hssc-route-line", revision: 7, data: { path: "none" } });
    await fresh.findRouteLine();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "bus.hssc_route_line.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "bus.hssc_route_line.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
