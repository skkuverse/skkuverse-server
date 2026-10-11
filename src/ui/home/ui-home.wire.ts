import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";
import { bannerCarousel } from "../ui.wire";

/** WHY: an image at an absolute URL, or an emoji the app renders in Tossface. */
const tileIcon = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remote"), uri: z.string() }),
  z.object({ kind: z.literal("emoji"), emoji: z.string() }),
]);

/** CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/home/schema.ts drops a tile of an unknown kind. */
const tile = z.discriminatedUnion("kind", [
  /** WHY: a registered mini app by id; its name and logo come from GET /miniapps. */
  z.object({ kind: z.literal("miniapp"), id: z.string() }),
  /** WHY: a game bundled into the app, which names and draws it; a build without it drops the tile. */
  z.object({ kind: z.literal("game"), id: z.string() }),
  z.object({
    kind: z.literal("link"),
    id: z.string(),
    title: z.string(),
    icon: tileIcon,
    actionType: linkActionType,
    actionValue: z.string(),
  }),
]);

const tileGrid = z.object({
  type: z.literal("tile_grid"),
  id: z.string(),
  title: z.string().optional(),
  tiles: z.array(tile),
});

/** WHY: where a mini app's broadcast feed card sits; the app fetches the entries itself. */
const miniAppFeed = z.object({
  type: z.literal("miniapp_feed"),
  id: z.string(),
  miniAppId: z.string(),
  title: z.string().optional(),
  limit: z.int(),
});

/**
 * CONTRACT(skkuverse-app): skkuverse-app/packages/shared/src/home/schema.ts parses this tolerantly and skips a
 * section of an unknown type.
 */
export const homeLayout = z.object({
  version: z.int(),
  sections: z.array(z.discriminatedUnion("type", [bannerCarousel, tileGrid, miniAppFeed])),
});

export type HomeLayout = z.input<typeof homeLayout>;
