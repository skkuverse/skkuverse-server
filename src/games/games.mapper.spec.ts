/**
 * toGameRegistry, the frozen snapshot GamesService serves one revision of the `games` dataset as: every entry in
 * the dataset's order, disabled ones included, each with only its named fields, and an entry looked up by its id.
 * toGameEntry, one entry as GET /games and GET /games/:id send it.
 */
import { listedGames } from "../../__tests__/helpers/games/games-fixture";
import { toGameEntry, toGameRegistry } from "./games.mapper";
import { gamesFile, type GameEntryRaw } from "./games.schema";

const parsed = () => gamesFile.parse(listedGames());

describe("toGameEntry", () => {
  it("serves its four fields, frozen", () => {
    // Arrange
    const raw: GameEntryRaw = { id: "apple-game", entryUrl: "https://apple-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 };

    // Act
    const entry = toGameEntry(raw);

    // Assert
    expect(entry).toEqual(raw);
    expect(Object.keys(entry)).toEqual(["id", "entryUrl", "enabled", "minHostProtocol"]);
    expect(Object.isFrozen(entry)).toBe(true);
  });
});

describe("toGameRegistry", () => {
  it("keeps the revision and every entry in the dataset's order, disabled ones too", () => {
    // Act
    const registry = toGameRegistry(parsed(), 4);

    // Assert
    expect(registry.revision).toBe(4);
    expect(registry.entries.map((entry) => [entry.id, entry.enabled])).toEqual([
      ["apple-game", true],
      ["suika-game", false],
    ]);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.entries)).toBe(true);
  });

  it("looks an entry up by its id, and none for an id it does not list", () => {
    // Act
    const registry = toGameRegistry(parsed(), 1);

    // Assert
    expect(registry.entryOf("suika-game")).toEqual(listedGames().games[1]);
    expect(registry.entryOf("wave-run")).toBeUndefined();
    expect(registry.entryOf("constructor")).toBeUndefined();
  });

  it("serves an empty revision as no entry", () => {
    // Act
    const registry = toGameRegistry({ games: [] }, 1);

    // Assert
    expect(registry.entries).toEqual([]);
    expect(registry.entryOf("apple-game")).toBeUndefined();
  });
});
