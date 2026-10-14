import { z } from "zod";
import { miniAppIndexEntry } from "../miniapps.wire";

/** WHY: `version` is the registry schema's: bumped only on a breaking change, which no client gates on yet. */
export const miniAppIndex = z.object({
  version: z.number(),
  miniApps: z.array(miniAppIndexEntry),
});

export type MiniAppIndex = z.input<typeof miniAppIndex>;
