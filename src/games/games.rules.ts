import { AppError } from "../http/app.error";
import type { GameIds, GameIssue } from "./games.types";

export function toGameNotFound(id: string): AppError {
  return new AppError("GAME_NOT_FOUND", `Unknown game id: ${id}`, 404);
}

export function toDuplicateGameIdIssues({ games }: GameIds): GameIssue[] {
  const ids = games.map((game) => game.id);
  return ids.flatMap((id, position) => (ids.indexOf(id) !== position ? [{ path: ["games", position, "id"], message: `duplicate game id "${id}"` }] : []));
}
