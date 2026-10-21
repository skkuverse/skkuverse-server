/**
 * The registry's rules (skkuverse-app add-game-factory designs D2 and D3). toGameNotFound is the 404 an unlisted id
 * gets on GET /games/:id. toDuplicateGameIdIssues refuses an id listed twice, at each repeat after the first.
 *
 * toGameOriginIssues holds each entry to the origin the code maps to its id: an id with no origin is refused at
 * the id, and an entry URL off that origin (another game's, a mini app's, a near-miss host, a port, a credential)
 * at the URL. toTakenIdIssues refuses, at each of a registry's ids, one the other registry holds, naming it;
 * gameIdsOf gives a games revision's ids at their paths for that check.
 */
import { gameIdsOf, toDuplicateGameIdIssues, toGameNotFound, toGameOriginIssues, toTakenIdIssues } from "./games.rules";

const OWNERS = {
  "https://apple-game.game.skkuverse.com": "apple-game",
  "https://suika-game.game.skkuverse.com": "suika-game",
};

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

describe("toGameOriginIssues", () => {
  const entry = (id: string, entryUrl: string) => ({ games: [{ id, entryUrl }] });

  it.each([
    ["the origin's root", "https://apple-game.game.skkuverse.com/"],
    ["a path on the origin", "https://apple-game.game.skkuverse.com/play/index.html"],
    ["the origin with its default port", "https://apple-game.game.skkuverse.com:443/"],
    ["the origin's host in capitals", "https://APPLE-GAME.game.skkuverse.com/"],
  ])("passes an entry URL at %s", (_case, entryUrl) => {
    // Act & Assert
    expect(toGameOriginIssues(entry("apple-game", entryUrl), OWNERS)).toEqual([]);
  });

  it.each([
    ["another game's origin", "https://suika-game.game.skkuverse.com/"],
    ["a mini app's origin", "https://mukja.mini.skkuverse.com/"],
    ["the web view", "https://webview.skkuverse.com/apple-game"],
    ["a near-miss host", "https://apple-game.game.skkuverse.com.evil.com/"],
    ["a trailing-dot host", "https://apple-game.game.skkuverse.com./"],
    ["another port", "https://apple-game.game.skkuverse.com:8443/"],
    ["a credential before the host", "https://user@apple-game.game.skkuverse.com/"],
    ["a URL that does not parse", "https://apple game/"],
  ])("refuses an entry URL on %s, at the URL", (_case, entryUrl) => {
    // Act & Assert
    expect(toGameOriginIssues(entry("apple-game", entryUrl), OWNERS)).toEqual([
      { path: ["games", 0, "entryUrl"], message: '"apple-game" owns https://apple-game.game.skkuverse.com, so its entryUrl must be on it' },
    ]);
  });

  it("refuses an id no first-party game origin maps to, at the id", () => {
    // Act & Assert
    expect(toGameOriginIssues(entry("new-game", "https://new-game.game.skkuverse.com/"), OWNERS)).toEqual([
      { path: ["games", 0, "id"], message: '"new-game" has no first-party game origin in src/infra/origins.ts' },
    ]);
  });

  it("checks every entry, at its own position", () => {
    // Arrange
    const games = [
      { id: "apple-game", entryUrl: "https://apple-game.game.skkuverse.com/" },
      { id: "suika-game", entryUrl: "https://apple-game.game.skkuverse.com/" },
    ];

    // Act & Assert
    expect(toGameOriginIssues({ games }, OWNERS)).toEqual([
      { path: ["games", 1, "entryUrl"], message: '"suika-game" owns https://suika-game.game.skkuverse.com, so its entryUrl must be on it' },
    ]);
  });
});

describe("toTakenIdIssues", () => {
  const ids = [
    { id: "apple-game", path: ["games", 0, "id"] },
    { id: "timetable", path: ["games", 1, "id"] },
  ];

  it.each([
    ["no taken id", [], []],
    ["ids the registry does not hold", ["mukja", "inja"], []],
    ["one id the other registry holds", ["mukja", "timetable"], [{ path: ["games", 1, "id"], message: '"timetable" is already an id in miniapps' }]],
  ])("answers %s", (_case, taken, issues) => {
    // Act & Assert
    expect(toTakenIdIssues(ids, taken, "miniapps")).toEqual(issues);
  });
});

describe("gameIdsOf", () => {
  it("gives each id at its path", () => {
    // Act & Assert
    expect(gameIdsOf({ games: [{ id: "apple-game" }, { id: "suika-game" }] })).toEqual([
      { id: "apple-game", path: ["games", 0, "id"] },
      { id: "suika-game", path: ["games", 1, "id"] },
    ]);
  });
});
