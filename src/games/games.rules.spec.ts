/**
 * (An operations detail is left out of the public history.)
 */
import { toDuplicateGameIdIssues, toGameNotFound } from "./games.rules";

describe("toGameNotFound", () => {
  it("is a 404 GAME_NOT_FOUND naming the id", () => {
    // Act
    const error = toGameNotFound("no-such-game");

    // Assert
    expect(error.httpStatus).toBe(404);
    expect(error.code).toBe("GAME_NOT_FOUND");
    expect(error.message).toBe("Unknown game id: no-such-game");
  });
});

describe("toDuplicateGameIdIssues", () => {
  it.each([
    ["no game", [], []],
    ["distinct ids", ["apple-game", "suika-game"], []],
    ["one id twice", ["apple-game", "apple-game"], [{ path: ["games", 1, "id"], message: 'duplicate game id "apple-game"' }]],
    [
      "one id three times, apart",
      ["apple-game", "suika-game", "apple-game", "apple-game"],
      [
        { path: ["games", 2, "id"], message: 'duplicate game id "apple-game"' },
        { path: ["games", 3, "id"], message: 'duplicate game id "apple-game"' },
      ],
    ],
  ])("answers %s", (_case, ids, issues) => {
    // Act & Assert
    expect(toDuplicateGameIdIssues({ games: ids.map((id) => ({ id })) })).toEqual(issues);
  });
});
