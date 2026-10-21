import type { GamesFile } from "./games.schema";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface GamesDatasetDoc {
  _id: string;
  revision: number;
  data: GamesFile;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredGames = Pick<GamesDatasetDoc, "revision" | "data">;
