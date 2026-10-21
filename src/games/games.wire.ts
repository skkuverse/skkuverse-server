import { z } from "zod";

/** WHY: exposure only: whether a game is ranked, and how a score is checked, are the app's and its functions'. */
export const gameEntry = z.object({
  id: z.string(),
  /** WHY: on the game's own origin, the one GAME_ID_BY_FIRST_PARTY_ORIGIN maps to its id. */
  entryUrl: z.string(),
  /** WHY: false hides the game, even from a build that bundles a copy of it. */
  enabled: z.boolean(),
  /** WHY: the lowest game protocol a host must speak to open the page; an older host hides the game. */
  minHostProtocol: z.number(),
});

/** WHY: lists every entry, disabled ones too: a listed id is never opened from a bundled copy. */
export const gameIndex = z.object({
  games: z.array(gameEntry),
});

export type GameEntry = z.input<typeof gameEntry>;

export type GameIndex = z.input<typeof gameIndex>;
