import { AppError } from "../http/app.error";
import type { EntryUrls, GameIds, GameIssue, LocatedId } from "./games.types";

export function toGameNotFound(id: string): AppError {
  return new AppError("GAME_NOT_FOUND", `Unknown game id: ${id}`, 404);
}

export function toDuplicateGameIdIssues({ games }: GameIds): GameIssue[] {
  const ids = games.map((game) => game.id);
  return ids.flatMap((id, position) => (ids.indexOf(id) !== position ? [{ path: ["games", position, "id"], message: `duplicate game id "${id}"` }] : []));
}

export function gameIdsOf({ games }: GameIds): LocatedId[] {
  return games.map((game, position) => ({ id: game.id, path: ["games", position, "id"] }));
}

// WHY: `origin` drops userinfo, so a URL that carries one is refused apart: the page must load as the origin itself.
function isOnOrigin(url: string, origin: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.origin === origin && parsed.username === "" && parsed.password === "";
}

function entryUrlIssues({ id, entryUrl }: EntryUrls["games"][number], position: number, originOfId: ReadonlyMap<string, string>): GameIssue[] {
  const origin = originOfId.get(id);
  if (origin === undefined) return [{ path: ["games", position, "id"], message: `"${id}" has no first-party game origin in src/infra/origins.ts` }];
  if (isOnOrigin(entryUrl, origin)) return [];
  return [{ path: ["games", position, "entryUrl"], message: `"${id}" owns ${origin}, so its entryUrl must be on it` }];
}

// WHY: which origin a game owns is a trust decision held in code; a push may not point a game at another origin.
export function toGameOriginIssues({ games }: EntryUrls, owners: Readonly<Record<string, string>>): GameIssue[] {
  const originOfId = new Map(Object.entries(owners).map(([origin, id]) => [id, origin]));
  return games.flatMap((game, position) => entryUrlIssues(game, position, originOfId));
}

// WHY: the registries share one id namespace, so neither may list an id the other holds.
export function toTakenIdIssues(ids: readonly LocatedId[], takenIds: readonly string[], registry: string): GameIssue[] {
  const taken = new Set(takenIds);
  return ids.filter(({ id }) => taken.has(id)).map(({ id, path }) => ({ path, message: `"${id}" is already an id in ${registry}` }));
}
