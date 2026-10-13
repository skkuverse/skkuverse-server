import type { SupportedLang } from "../../infra/types";
import { toBannerCarousel, toLocalizedText } from "../ui.mapper";
import type { LogoResolver } from "./ui-home.types";
import type { HomeLayoutRaw, TileRaw } from "./ui-home.schema";
import type { HomeLayout } from "./ui-home.wire";

type Section = HomeLayout["sections"][number];
type Tile = Extract<Section, { type: "tile_grid" }>["tiles"][number];
type SectionRaw = HomeLayoutRaw["sections"][number];

interface HomeLayoutContext {
  lang: SupportedLang;
  now: Date;
  resolveLogo: LogoResolver;
}

function toTile(tile: TileRaw, context: HomeLayoutContext): Tile {
  if (tile.kind !== "link") return { kind: tile.kind, id: tile.id };
  return {
    kind: "link",
    id: tile.id,
    title: toLocalizedText(tile.title, context.lang),
    icon: context.resolveLogo(tile.icon),
    actionType: tile.actionType,
    actionValue: tile.actionValue,
  };
}

function toSection(section: SectionRaw, context: HomeLayoutContext): Section {
  // WHY: a carousel whose images have all closed is kept: the app draws its default banner in an empty one.
  if (section.type === "banner_carousel") return toBannerCarousel(section, context.lang, context.now);
  const title = section.title === undefined ? {} : { title: toLocalizedText(section.title, context.lang) };
  if (section.type === "tile_grid") {
    return { type: "tile_grid", id: section.id, ...title, tiles: section.tiles.map((tile) => toTile(tile, context)) };
  }
  return { type: "miniapp_feed", id: section.id, miniAppId: section.miniAppId, ...title, limit: section.limit };
}

export function toHomeLayout(layout: HomeLayoutRaw, context: HomeLayoutContext): HomeLayout {
  return { version: layout.version, sections: layout.sections.map((section) => toSection(section, context)) };
}
