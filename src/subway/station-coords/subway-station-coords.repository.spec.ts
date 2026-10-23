/**
 * SubwayStationCoordsRepository: the read of the stored `subway-station-coords` dataset, which `npm run data`
 * writes and the server only parses (ADR 0013, D6).
 *
 * The query object is pinned here, since FakeSubwayStationCoordsRepository copies it: one document by `_id`,
 * projecting only the revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A
 * missing document and one that fails the schema both read as `null`, each logged at error so a person looks, at
 * most once a minute (an invalid one once a minute per revision): the arrivals route then keeps its last good
 * value, or answers 503. A failed read rejects as SubwayStationCoordsReadError.
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

import { logText } from "../../../__tests__/helpers/log-text";
import { stationCoordsFixture } from "../../../__tests__/helpers/subway/station-coords";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { SubwayStationCoordsRepository } from "./subway-station-coords.repository";

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

describe("SubwayStationCoordsRepository.findCoords", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-station-coords", revision: 2, data: stationCoordsFixture() });

    // Act
    await new SubwayStationCoordsRepository().findCoords();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "subway-station-coords" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed coords", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-station-coords", revision: 2, data: stationCoordsFixture() });

    // Act
    const stored = await new SubwayStationCoordsRepository().findCoords();

    // Assert
    expect(stored).toEqual({ revision: 2, data: stationCoordsFixture() });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as subway.station_coords.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new SubwayStationCoordsRepository().findCoords();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.station_coords.missing", dataset: "subway-station-coords" });
  });

  it("returns null for a document that fails the schema, logged at error as subway.station_coords.invalid with its revision and issues", async () => {
    // Arrange
    const data = stationCoordsFixture();
    data.stations.hyehwa = { lat: 127.001844, lng: 37.582336 };
    findOne.mockResolvedValue({ _id: "subway-station-coords", revision: 5, data });

    // Act
    const stored = await new SubwayStationCoordsRepository().findCoords();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.station_coords.invalid", dataset: "subway-station-coords", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.stations\.hyehwa: must be \{ lat, lng \} inside South Korea/);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-station-coords", data: stationCoordsFixture() });

    // Act
    const stored = await new SubwayStationCoordsRepository().findCoords();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.station_coords.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("rejects a failing read as SubwayStationCoordsReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new SubwayStationCoordsRepository().findCoords()).rejects.toMatchObject({ name: "SubwayStationCoordsReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new SubwayStationCoordsRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findCoords();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findCoords();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.station_coords.missing", suppressed: 0 }),
      expect.objectContaining({ event: "subway.station_coords.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new SubwayStationCoordsRepository();
    findOne.mockResolvedValue({ _id: "subway-station-coords", revision: 6, data: { stations: { hyehwa: {} } } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findCoords();
    findOne.mockResolvedValue({ _id: "subway-station-coords", revision: 7, data: { stations: { hyehwa: {} } } });
    await fresh.findCoords();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.station_coords.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "subway.station_coords.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
