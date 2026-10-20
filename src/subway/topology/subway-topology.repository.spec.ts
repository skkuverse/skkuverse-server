/**
 * SubwayTopologyRepository: the read of the stored `subway-topology` dataset, which `npm run data`
 * writes and the server only parses (ADR 0013, D6; move-reference-datasets D3).
 *
 * The query object is pinned here, since FakeSubwayTopologyRepository copies it: one document by `_id`,
 * projecting only the revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A
 * missing document and one that fails the schema both read as `null`, each logged at error so a person looks, at
 * most once a minute (an invalid one once a minute per revision): the arrivals route and the Seoul pollers then keep
 * their last good value, or answer 503 and reject. A failed read rejects as SubwayTopologyReadError.
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

import { subwayTopologyFixture } from "../../../__tests__/helpers/subway/topology";
import { logText } from "../../../__tests__/helpers/log-text";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { SubwayTopologyRepository } from "./subway-topology.repository";

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

describe("SubwayTopologyRepository.findTopology", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-topology", revision: 2, data: subwayTopologyFixture() });

    // Act
    await new SubwayTopologyRepository().findTopology();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "subway-topology" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed topology", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-topology", revision: 2, data: subwayTopologyFixture() });

    // Act
    const stored = await new SubwayTopologyRepository().findTopology();

    // Assert
    expect(stored).toEqual({ revision: 2, data: subwayTopologyFixture() });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as subway.topology.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new SubwayTopologyRepository().findTopology();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.topology.missing", dataset: "subway-topology" });
  });

  it("returns null for a document that fails the schema, logged at error as subway.topology.invalid with its revision and issues", async () => {
    // Arrange
    const data = subwayTopologyFixture() as unknown as { platforms: Record<string, { up: { nextPlatformId: string } }> };
    data.platforms["S1-4-420"]!.up.nextPlatformId = "s1-4-419";
    findOne.mockResolvedValue({ _id: "subway-topology", revision: 5, data });

    // Act
    const stored = await new SubwayTopologyRepository().findTopology();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.topology.invalid", dataset: "subway-topology", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.platforms\.S1-4-420\.up\.nextPlatformId: must be <operator>-<line>-<station>/);
  });

  it("returns null for a document with no revision, logged as invalid", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "subway-topology", data: subwayTopologyFixture() });

    // Act
    const stored = await new SubwayTopologyRepository().findTopology();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "subway.topology.invalid" });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/revision: /);
  });

  it("rejects a failing read as SubwayTopologyReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new SubwayTopologyRepository().findTopology()).rejects.toMatchObject({ name: "SubwayTopologyReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new SubwayTopologyRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findTopology();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findTopology();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.topology.missing", suppressed: 0 }),
      expect.objectContaining({ event: "subway.topology.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new SubwayTopologyRepository();
    findOne.mockResolvedValue({ _id: "subway-topology", revision: 6, data: { platforms: { "S1-4-420": {} }, neighbors: {} } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findTopology();
    findOne.mockResolvedValue({ _id: "subway-topology", revision: 7, data: { platforms: { "S1-4-420": {} }, neighbors: {} } });
    await fresh.findTopology();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "subway.topology.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "subway.topology.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
