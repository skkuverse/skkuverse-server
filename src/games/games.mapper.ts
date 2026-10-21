import type { GameEntryRaw, GamesFile } from "./games.schema";
import type { GameRegistry } from "./games.types";
import type { GameEntry } from "./games.wire";

// WHY: named fields rather than `...entry`, so no stored value reaches the wire past the schema.
export function toGameEntry(entry: GameEntryRaw): Readonly<GameEntry> {
  return Object.freeze({ id: entry.id, entryUrl: entry.entryUrl, enabled: entry.enabled, minHostProtocol: entry.minHostProtocol });
}

export function toGameRegistry({ games }: GamesFile, revision: number): GameRegistry {
  const entries = Object.freeze(games.map(toGameEntry));
  const entriesById: ReadonlyMap<string, Readonly<GameEntry>> = new Map(entries.map((entry) => [entry.id, entry]));
  return Object.freeze({ revision, entries, entryOf: (id: string) => entriesById.get(id) });
}
