import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";

/** WHY: in the request's language, falling back to Korean: a push carries ko and en only. */
const miniAppFeedEntry = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  sentAt: z.iso.datetime(),
  actionType: linkActionType.optional(),
  actionValue: z.string().optional(),
});

/** CONTRACT(skkuverse-app): parsed by skkuverse-app/packages/shared/src/miniapps/feed-parse.ts. */
export const miniAppFeed = z.array(miniAppFeedEntry);

export type MiniAppFeedEntry = z.input<typeof miniAppFeedEntry>;

export type MiniAppFeed = z.input<typeof miniAppFeed>;
