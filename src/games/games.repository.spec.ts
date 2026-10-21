/**
 * GamesRepository: the read of the stored `games` dataset, which `npm run data` writes and the server only parses
 * (ADR 0013, D6; skkuverse-app add-game-factory design D3).
 *
 * The query object is pinned here, since FakeGamesRepository copies it: one document by `_id`, projecting only the
 * revision and the data, bounded by `maxTimeMS`, on the content database's `datasets`. A missing document and one
 * that fails the schema both read as `null`, each logged at error so a person looks, at most once a minute (an
 * invalid one once a minute per revision): the routes then keep their last good registry or answer 503. A failed
 * read rejects as GamesRegistryReadError.
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

import { listedGames } from "../../__tests__/helpers/games/games-fixture";
import { logText } from "../../__tests__/helpers/log-text";
import config from "../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../infra/db";
import { GamesRepository } from "./games.repository";

const NOW = new Date("2026-10-21T03:00:00.000Z");
const LOG_INTERVAL_MS = 60_000;

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  findOne.mockReset();
  openedCollections.length = 0;
  jest.clearAllMocks();
});

describe("GamesRepository.findGames", () => {
  it("reads one document by _id from the content database's datasets, projecting the revision and data, bounded", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "games", revision: 2, data: listedGames() });

    // Act
    await new GamesRepository().findGames();

    // Assert
    expect(openedCollections).toEqual([{ dbName: config.content.dbName, name: config.content.collections.datasets }]);
    expect(findOne).toHaveBeenCalledWith({ _id: "games" }, { projection: { revision: 1, data: 1 }, maxTimeMS: HOT_READ_MAX_TIME_MS });
  });

  it("returns the revision and the parsed games", async () => {
    // Arrange
    findOne.mockResolvedValue({ _id: "games", revision: 2, data: listedGames() });

    // Act
    const stored = await new GamesRepository().findGames();

    // Assert
    expect(stored).toEqual({ revision: 2, data: listedGames() });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("returns null for a missing document, logged at error as games.registry.missing", async () => {
    // Arrange
    findOne.mockResolvedValue(null);

    // Act
    const stored = await new GamesRepository().findGames();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "games.registry.missing", dataset: "games" });
  });

  it("returns null for a document that fails the schema, logged at error as games.registry.invalid with its revision and issues", async () => {
    // Arrange
    const data = listedGames();
    data.games[0]!.minHostProtocol = 0;
    findOne.mockResolvedValue({ _id: "games", revision: 5, data });

    // Act
    const stored = await new GamesRepository().findGames();

    // Assert
    expect(stored).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][0]).toMatchObject({ event: "games.registry.invalid", dataset: "games", revision: 5 });
    expect(logText(mockLogger.error.mock.calls[0])).toMatch(/data\.games\.0\.minHostProtocol: /);
  });

  it("rejects a failing read as GamesRegistryReadError, carrying the driver's error as its cause", async () => {
    // Arrange
    const failure = new Error("server selection timed out");
    findOne.mockRejectedValue(failure);

    // Act & Assert
    await expect(new GamesRepository().findGames()).rejects.toMatchObject({ name: "GamesRegistryReadError", cause: failure });
  });

  it("logs a missing document at most once a minute, then with the lines it held back", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new GamesRepository();
    findOne.mockResolvedValue(null);

    // Act
    for (let read = 0; read < 5; read++) await fresh.findGames();
    jest.setSystemTime(NOW.getTime() + LOG_INTERVAL_MS);
    await fresh.findGames();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "games.registry.missing", suppressed: 0 }),
      expect.objectContaining({ event: "games.registry.missing", suppressed: 4 }),
    ]);
  });

  it("logs an invalid revision at most once a minute, and a new invalid revision at once", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW });
    const fresh = new GamesRepository();
    findOne.mockResolvedValue({ _id: "games", revision: 6, data: { games: [{}] } });

    // Act
    for (let read = 0; read < 3; read++) await fresh.findGames();
    findOne.mockResolvedValue({ _id: "games", revision: 7, data: { games: [{}] } });
    await fresh.findGames();

    // Assert
    expect(mockLogger.error.mock.calls.map(([fields]) => fields)).toEqual([
      expect.objectContaining({ event: "games.registry.invalid", revision: 6, suppressed: 0 }),
      expect.objectContaining({ event: "games.registry.invalid", revision: 7, suppressed: 0 }),
    ]);
  });
});
