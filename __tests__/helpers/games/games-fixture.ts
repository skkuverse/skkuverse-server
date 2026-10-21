/**
 * The `games` dataset as the specs and route tests seed it: revision 1, empty, from
 * __tests__/nest/games/fixtures/games.dataset.json without its provenance note, and a listed revision with
 * apple-game enabled and suika-game disabled, each on the origin src/infra/origins.ts maps to its id.
 */
import fs from "fs";
import path from "path";

const FIXTURE = path.join(__dirname, "../../nest/games/fixtures/games.dataset.json");

export interface GamesData {
  games: Array<Record<string, unknown>>;
}

export function emptyGames(): GamesData {
  const dataset = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as GamesData & { _about?: string };
  delete dataset._about;
  return dataset;
}

export function listedGames(): GamesData {
  return {
    games: [
      { id: "apple-game", entryUrl: "https://apple-game.game.skkuverse.com/", enabled: true, minHostProtocol: 1 },
      { id: "suika-game", entryUrl: "https://suika-game.game.skkuverse.com/", enabled: false, minHostProtocol: 1 },
    ],
  };
}
