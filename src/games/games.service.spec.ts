/**
 * GamesService, the reader of the stored `games` dataset (skkuverse-app add-game-factory design D3; ADR 0013, D6),
 * over an in-memory store and a fixed clock. `index()` serves every entry of one revision in its order, disabled
 * ones included, and `detail(id)` one entry or null for an id the revision does not list. A push is seen once
 * DATASET_CACHE_TTL_MS has passed, a failed reload keeps the last good revision, and with no good revision both
 * throw the 503 GamesRegistryUnavailableError. An entry the first-party game origins in code disagree with (its
 * URL off its game's origin, or an id with none) is still served, and logged at error once per revision.
 *
 * The cached loader reads `Date.now()`, so the TTL is crossed with Jest's fake system time.
 */
jest.mock("../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
import { emptyGames, listedGames } from "../../__tests__/helpers/games/games-fixture";
import { FakeGamesRepository } from "../../__tests__/helpers/fakes/games/games.repository.fake";
import { asReal } from "../../__tests__/helpers/fakes/public-of";
import type { Clock } from "../infra/clock";
import logger from "../infra/logger";
import { DATASET_CACHE_TTL_MS } from "../shared/dataset.constants";
import { GamesRegistryUnavailableError } from "./games.error";
import type { GamesRepository } from "./games.repository";
import { GamesService } from "./games.service";

const NOW = new Date("2026-10-21T04:00:00.000Z");
const mockedLogger = logger as unknown as Record<"error", jest.Mock>;
const ownerMismatches = () => mockedLogger.error.mock.calls.map(([fields]) => fields).filter((fields) => fields?.event === "games.registry.owner_mismatch");

function setup() {
  let now = NOW;
  const clock: Clock = { now: () => now };
  const repository = new FakeGamesRepository();
  const games = new GamesService(asReal<GamesRepository>(repository), clock);
  // The clock and Date.now() move together: the dataset loader reads the one, the cached loader the other.
  const advanceTo = (msAfterNow: number): void => {
    now = new Date(NOW.getTime() + msAfterNow);
    jest.setSystemTime(now);
  };
  return { repository, games, advanceTo };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("GamesService.index", () => {
  it("serves every stored entry in the dataset's order, disabled ones too", async () => {
    // Arrange
    const { repository, games } = setup();
    repository.storeGames(listedGames());

    // Act
    const index = await games.index();

    // Assert
    expect(index).toEqual(listedGames());
  });

  it("serves revision 1 as no game", async () => {
    // Arrange
    const { repository, games } = setup();
    repository.storeGames(emptyGames());

    // Act & Assert
    expect(await games.index()).toEqual({ games: [] });
  });

  it("serves a push once the TTL has passed, and not before", async () => {
    // Arrange
    const { repository, games, advanceTo } = setup();
    repository.storeGames(emptyGames());
    await games.index();
    repository.storeGames(listedGames());

    // Act
    advanceTo(DATASET_CACHE_TTL_MS - 1);
    const before = await games.index();
    advanceTo(DATASET_CACHE_TTL_MS + 1);
    const after = await games.index();

    // Assert
    expect(before).toEqual({ games: [] });
    expect(after).toEqual(listedGames());
  });

  it("keeps the last good revision through a failed reload", async () => {
    // Arrange
    const { repository, games, advanceTo } = setup();
    repository.storeGames(listedGames());
    await games.index();
    repository.failWith = new Error("server selection timed out");

    // Act
    advanceTo(DATASET_CACHE_TTL_MS + 1);
    const index = await games.index();

    // Assert
    expect(index).toEqual(listedGames());
  });

  it.each([
    ["no stored dataset", (repository: FakeGamesRepository) => void repository],
    ["a stored dataset that fails the schema", (repository: FakeGamesRepository) => void repository.storeGames({ games: [{ id: "apple-game" }] })],
    ["a failed read", (repository: FakeGamesRepository) => void (repository.failWith = new Error("server selection timed out"))],
  ])("throws GamesRegistryUnavailableError with %s and nothing read before", async (_case, arrange) => {
    // Arrange
    const { repository, games } = setup();
    arrange(repository);

    // Act & Assert
    await expect(games.index()).rejects.toBeInstanceOf(GamesRegistryUnavailableError);
  });
});

describe("GamesService.detail", () => {
  it("serves a listed entry, a disabled one too", async () => {
    // Arrange
    const { repository, games } = setup();
    repository.storeGames(listedGames());

    // Act & Assert
    expect(await games.detail("apple-game")).toEqual(listedGames().games[0]);
    expect(await games.detail("suika-game")).toEqual(listedGames().games[1]);
  });

  it("answers null for an id the revision does not list", async () => {
    // Arrange
    const { repository, games } = setup();
    repository.storeGames(listedGames());

    // Act & Assert
    expect(await games.detail("wave-run")).toBeNull();
  });

  it("throws GamesRegistryUnavailableError with no good revision", async () => {
    // Arrange
    const { games } = setup();

    // Act & Assert
    await expect(games.detail("apple-game")).rejects.toBeInstanceOf(GamesRegistryUnavailableError);
  });
});

describe("GamesService.index against the first-party game origins", () => {
  const offOrigin = () => ({
    games: [
      { id: "apple-game", entryUrl: "https://suika-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 },
      { id: "new-game", entryUrl: "https://new-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 },
    ],
  });

  it("serves an entry the origins in code disagree with, logging each at error with its path and reason", async () => {
    // Arrange
    const { repository, games } = setup();
    repository.storeGames(offOrigin());

    // Act
    const index = await games.index();

    // Assert
    expect(index).toEqual(offOrigin());
    expect(ownerMismatches()).toEqual([
      expect.objectContaining({ revision: 1, path: "games.0.entryUrl", reason: '"apple-game" owns https://apple-game.game.skkuverse.com, so its entryUrl must be on it' }),
      expect.objectContaining({ revision: 1, path: "games.1.id", reason: '"new-game" has no first-party game origin in src/infra/origins.ts' }),
    ]);
  });

  it("logs a mismatch once per revision, however often it reloads", async () => {
    // Arrange
    const { repository, games, advanceTo } = setup();
    repository.storeGames(offOrigin());
    await games.index();

    // Act
    advanceTo(DATASET_CACHE_TTL_MS + 1);
    await games.index();
    repository.storeGames(offOrigin());
    advanceTo(2 * DATASET_CACHE_TTL_MS + 2);
    await games.index();

    // Assert
    expect(ownerMismatches().map((fields) => fields.revision)).toEqual([1, 1, 2, 2]);
  });

  it("logs nothing for entries on their games' origins", async () => {
    // Arrange
    const { repository, games } = setup();
    repository.storeGames(listedGames());

    // Act
    await games.index();

    // Assert
    expect(ownerMismatches()).toEqual([]);
  });
});
