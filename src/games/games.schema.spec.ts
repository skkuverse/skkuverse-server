/**
 * gamesFile, the shape of the `games` dataset (skkuverse-app add-game-factory design D3): one entry per hosted game
 * with only what exposes it, its id, entry URL, enabled flag and minimum host game protocol. A push is refused on it
 * and the read parses with it. Revision 1 (the empty fixture) and a listed revision pass as they are; a missing or
 * misspelt field, an id outside the mini-app id grammar, an entry URL that is not https, a minimum protocol below 1
 * or fractional, and an id listed twice are refused at their paths. storedGames, the stored document as the
 * repository reads it, needs its revision and data.
 */
import { emptyGames, listedGames } from "../../__tests__/helpers/games/games-fixture";
import { gamesFile, storedGames } from "./games.schema";

// The fixture as untyped JSON, so a test can break its shape.
const listed = (): Record<string, any> => listedGames();

function messagesOf(raw: unknown): string[] {
  const result = gamesFile.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const withAppleGame = (patch: Record<string, unknown>): Record<string, any> => {
  const data = listed();
  data.games[0] = { ...data.games[0], ...patch };
  return data;
};

describe("gamesFile", () => {
  it("passes revision 1, which lists no game", () => {
    // Act & Assert
    expect(gamesFile.parse(emptyGames())).toEqual({ games: [] });
  });

  it("passes a listed revision as it is, in its order", () => {
    // Act
    const parsed = gamesFile.parse(listed());

    // Assert
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(listed()));
  });

  it("fails a copy without games", () => {
    // Act & Assert
    expect(messagesOf({})).toEqual(["games: Invalid input: expected array, received undefined"]);
  });

  it("fails a key the dataset does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf({ ...listed(), version: 1 })).toEqual([': Unrecognized key: "version"']);
  });

  it.each(Object.keys(listedGames().games[0]!))("fails an entry without %s, naming it", (field) => {
    // Arrange
    const data = listed();
    delete data.games[0][field];

    // Act & Assert
    expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`^games\\.0\\.${field}: `))]);
  });

  it("fails a misspelt key on an entry, naming it", () => {
    // Act & Assert
    expect(messagesOf(withAppleGame({ minhostProtocol: 1 }))).toEqual(['games.0: Unrecognized key: "minhostProtocol"']);
  });

  it.each([
    ["an id with a capital", { id: "Apple-game" }, "games.0.id"],
    ["an id with a space", { id: "apple game" }, "games.0.id"],
    ["an http entry URL", { entryUrl: "http://apple-game.game.skkuverse.com/" }, "games.0.entryUrl"],
    ["a relative entry URL", { entryUrl: "/apple-game/" }, "games.0.entryUrl"],
    ["an enabled flag as a string", { enabled: "true" }, "games.0.enabled"],
    ["a minimum host protocol of 0", { minHostProtocol: 0 }, "games.0.minHostProtocol"],
    ["a fractional minimum host protocol", { minHostProtocol: 1.5 }, "games.0.minHostProtocol"],
  ])("fails %s, naming its path", (_case, patch, at) => {
    // Act & Assert
    expect(messagesOf(withAppleGame(patch))).toEqual([expect.stringMatching(new RegExp(`^${at.replace(/\./g, "\\.")}: `))]);
  });

  it.each([
    ["a minimum host protocol of 1", { minHostProtocol: 1 }],
    ["a minimum host protocol of 2", { minHostProtocol: 2 }],
    ["an entry URL with a path", { entryUrl: "https://apple-game.game.skkuverse.com/play/" }],
  ])("passes %s", (_case, patch) => {
    // Act & Assert
    expect(messagesOf(withAppleGame(patch))).toEqual([]);
  });

  it("fails an id listed twice, at the second entry", () => {
    // Arrange
    const data = listed();
    data.games[1].id = "apple-game";

    // Act & Assert
    expect(messagesOf(data)).toEqual(['games.1.id: duplicate game id "apple-game"']);
  });
});

describe("storedGames", () => {
  it("passes a stored document with its revision and data", () => {
    // Act & Assert
    expect(storedGames.parse({ revision: 1, data: emptyGames() })).toEqual({ revision: 1, data: { games: [] } });
  });

  it.each([
    ["without a revision", { data: emptyGames() }],
    ["with revision 0", { revision: 0, data: emptyGames() }],
    ["without data", { revision: 1 }],
  ])("fails a document %s", (_case, doc) => {
    // Act & Assert
    expect(storedGames.safeParse(doc).success).toBe(false);
  });
});
