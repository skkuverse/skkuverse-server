import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";
import { findDuplicateId } from "../ui.rules";
import { bannerImage, carouselFields, localizedText, mediaUrl, slug } from "../ui.schema";
import * as limits from "./ui-home.rules";

const tileIcon = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("emoji"), emoji: z.string() }),
  z.strictObject({ kind: z.literal("media"), url: mediaUrl }),
]);

const linkFields = { title: localizedText, icon: tileIcon, actionType: linkActionType, actionValue: z.string() };

const tile = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("miniapp"), id: slug }),
  // WHY: which games a build ships is the app's to know; a build without this one drops the tile.
  z.strictObject({ kind: z.literal("game"), id: slug }),
  z.strictObject({ kind: z.literal("link"), id: slug, ...linkFields }),
]);

const homeCarousel = z
  .strictObject({
    ...carouselFields,
    items: z.array(z.discriminatedUnion("type", [bannerImage, z.strictObject({ type: z.literal("default") })])).min(1),
  })
  .refine((carousel) => carousel.items.filter((item) => item.type === "default").length <= 1, {
    message: "may place the default banner once",
  });

const tileGrid = z.strictObject({
  type: z.literal("tile_grid"),
  id: slug,
  title: localizedText.optional(),
  tiles: z.array(tile).min(1),
});

const miniAppFeed = z.strictObject({
  type: z.literal("miniapp_feed"),
  id: slug,
  miniAppId: z.string(),
  title: localizedText.optional(),
  limit: z.int().min(limits.MIN_MINIAPP_FEED_LIMIT).max(limits.MAX_MINIAPP_FEED_LIMIT).default(limits.DEFAULT_MINIAPP_FEED_LIMIT),
});

const section = z.discriminatedUnion("type", [homeCarousel, tileGrid, miniAppFeed]);

export const homeLayoutFile = z
  .strictObject({ version: z.literal(limits.HOME_LAYOUT_VERSION), sections: z.array(section) })
  .superRefine((layout, ctx) => {
    // WHY: section and banner ids share one namespace, and tile ids another: each is an analytics item id.
    const duplicateId = findDuplicateId(layout.sections.flatMap(sectionIds));
    const duplicateTile = findDuplicateId(layout.sections.flatMap(tileIds));
    if (duplicateId) ctx.addIssue({ code: "custom", message: `duplicate id "${duplicateId}"` });
    if (duplicateTile) ctx.addIssue({ code: "custom", message: `tile "${duplicateTile}" is placed more than once` });
  });

export type HomeLayoutRaw = z.output<typeof homeLayoutFile>;
type SectionRaw = HomeLayoutRaw["sections"][number];
export type TileRaw = Extract<SectionRaw, { type: "tile_grid" }>["tiles"][number];

function sectionIds(raw: SectionRaw): string[] {
  if (raw.type !== "banner_carousel") return [raw.id];
  return [raw.id, ...raw.items.flatMap((item) => (item.type === "image" ? [item.id] : []))];
}

function tileIds(raw: SectionRaw): string[] {
  return raw.type === "tile_grid" ? raw.tiles.map((t) => t.id) : [];
}
