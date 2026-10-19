import { z } from "zod";
import { linkActionType } from "../../shared/link-action.wire";
import { findRepeatedId } from "../ui.rules";
import { bannerImageFile, carouselFields, localizedText, mediaUrl, slug } from "../ui.schema";
import type { StoredHomeLayout } from "./ui-home.document";
import { DEFAULT_MINIAPP_FEED_LIMIT, HOME_LAYOUT_VERSION, MAX_MINIAPP_FEED_LIMIT, MIN_MINIAPP_FEED_LIMIT } from "./ui-home.constants";

const tileIconFile = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("emoji"), emoji: z.string() }),
  z.strictObject({ kind: z.literal("media"), url: mediaUrl }),
]);

const linkFields = { title: localizedText, icon: tileIconFile, actionType: linkActionType, actionValue: z.string() };

const tileFile = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("miniapp"), id: slug }),
  // WHY: which games a build ships is the app's to know; a build without this one drops the tile.
  z.strictObject({ kind: z.literal("game"), id: slug }),
  z.strictObject({ kind: z.literal("link"), id: slug, ...linkFields }),
]);

const homeCarousel = z
  .strictObject({
    ...carouselFields,
    items: z.array(z.discriminatedUnion("type", [bannerImageFile, z.strictObject({ type: z.literal("default") })])).min(1),
  })
  .refine((carousel) => carousel.items.filter((item) => item.type === "default").length <= 1, {
    path: [],
    message: "may place the default banner once",
  });

const tileGridFile = z.strictObject({ type: z.literal("tile_grid"), id: slug, title: localizedText.optional(), tiles: z.array(tileFile).min(1) });

const miniAppFeedFile = z.strictObject({
  type: z.literal("miniapp_feed"),
  id: slug,
  miniAppId: z.string(),
  title: localizedText.optional(),
  limit: z.int().min(MIN_MINIAPP_FEED_LIMIT).max(MAX_MINIAPP_FEED_LIMIT).default(DEFAULT_MINIAPP_FEED_LIMIT),
});

const section = z.discriminatedUnion("type", [homeCarousel, tileGridFile, miniAppFeedFile]);

export const homeLayoutFile = z
  .strictObject({ version: z.literal(HOME_LAYOUT_VERSION), sections: z.array(section) })
  .superRefine((layout, ctx) => {
    // WHY: section and banner ids share one namespace, and tile ids another: each is an analytics item id.
    const repeatedId = findRepeatedId(layout.sections.flatMap(sectionIds));
    const repeatedTile = findRepeatedId(layout.sections.flatMap(tileIds));
    if (repeatedId) ctx.addIssue({ code: "custom", path: repeatedId.path, message: `duplicate id "${repeatedId.id}"` });
    if (repeatedTile) ctx.addIssue({ code: "custom", path: repeatedTile.path, message: `tile "${repeatedTile.id}" is placed more than once` });
  });

export type HomeLayoutRaw = z.output<typeof homeLayoutFile>;

export const storedHomeLayout = z.object({ revision: z.int().positive(), data: homeLayoutFile }) satisfies z.ZodType<StoredHomeLayout>;
type SectionRaw = HomeLayoutRaw["sections"][number];
export type TileRaw = Extract<SectionRaw, { type: "tile_grid" }>["tiles"][number];

type LocatedId = { id: string; path: Array<string | number> };

function sectionIds(raw: SectionRaw, sectionIndex: number): LocatedId[] {
  const own = { id: raw.id, path: ["sections", sectionIndex, "id"] };
  if (raw.type !== "banner_carousel") return [own];
  const images = raw.items.flatMap((item, j) => (item.type === "image" ? [{ id: item.id, path: ["sections", sectionIndex, "items", j, "id"] }] : []));
  return [own, ...images];
}

function tileIds(raw: SectionRaw, sectionIndex: number): LocatedId[] {
  return raw.type === "tile_grid" ? raw.tiles.map((t, j) => ({ id: t.id, path: ["sections", sectionIndex, "tiles", j, "id"] })) : [];
}
