import type { GameEntry } from "./games.wire";

export interface GameIssue {
  path: Array<string | number>;
  message: string;
}

export interface LocatedId {
  id: string;
  path: Array<string | number>;
}

export interface GameIds {
  games: ReadonlyArray<{ id: string }>;
}

export interface EntryUrls {
  games: ReadonlyArray<{ id: string; entryUrl: string }>;
}

/** WHY: one registry revision, frozen, so the index and the detail of one request agree. */
export interface GameRegistry {
  readonly revision: number;
  readonly entries: ReadonlyArray<Readonly<GameEntry>>;
  entryOf(id: string): Readonly<GameEntry> | undefined;
}
