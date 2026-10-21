import { z } from "zod";
import { ABSOLUTE_HTTPS_RE } from "../shared/link-target.constants";
import { REGISTRY_ID_RE } from "../shared/registry-id.constants";
import type { StoredGames } from "./games.document";
import { toDuplicateGameIdIssues } from "./games.rules";
import { gameEntry } from "./games.wire";

// WHY: strict, because a misspelt key (`minhostProtocol`) would pass and do nothing: the reader reads these names only.
const gameEntryRaw = gameEntry
  .extend({
    id: z.string().regex(REGISTRY_ID_RE),
    entryUrl: z.string().regex(ABSOLUTE_HTTPS_RE),
    minHostProtocol: z.int().positive(),
  })
  .strict();

export const gamesFile = z.strictObject({ games: z.array(gameEntryRaw) }).superRefine((file, ctx) => {
  for (const { path, message } of toDuplicateGameIdIssues(file)) ctx.addIssue({ code: "custom", path, message });
});

export type GameEntryRaw = z.output<typeof gameEntryRaw>;

export type GamesFile = z.output<typeof gamesFile>;

export const storedGames = z.object({ revision: z.int().positive(), data: gamesFile }) satisfies z.ZodType<StoredGames>;
