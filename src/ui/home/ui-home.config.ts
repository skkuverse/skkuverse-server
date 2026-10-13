import fs from "fs";
import path from "path";
import { isBrokenLinkAction } from "../ui.rules";
import { parseConfigFile, type BannerImageRaw } from "../ui.schema";
import type { MiniAppRegistry } from "../ui.types";
import { homeLayoutFile, type HomeLayoutRaw, type TileRaw } from "./ui-home.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const HOME_LAYOUT_FILE = path.join(__dirname, "home-layout.json");

type SectionRaw = HomeLayoutRaw["sections"][number];
type LinkTileRaw = Extract<TileRaw, { kind: "link" }>;

const tilesOf = (section: SectionRaw): TileRaw[] => (section.type === "tile_grid" ? section.tiles : []);
const isLinkTile = (tile: TileRaw): tile is LinkTileRaw => tile.kind === "link";

function linksOf(section: SectionRaw): Array<BannerImageRaw | LinkTileRaw> {
  const images = section.type === "banner_carousel" ? section.items.flatMap((i) => (i.type === "image" ? [i] : [])) : [];
  return [...images, ...tilesOf(section).filter(isLinkTile)];
}

function miniAppIdsOf(section: SectionRaw): string[] {
  if (section.type === "miniapp_feed") return [section.miniAppId];
  return tilesOf(section).flatMap((tile) => (tile.kind === "miniapp" ? [tile.id] : []));
}

const isBrokenIcon = (tile: LinkTileRaw, registry: MiniAppRegistry): boolean =>
  tile.icon.kind === "emoji" && !registry.isSingleEmoji(tile.icon.emoji);

function registryIssues(layout: HomeLayoutRaw, registry: MiniAppRegistry): string[] {
  const { sections } = layout;
  const unregistered = sections.flatMap(miniAppIdsOf).filter((id) => !registry.map.has(id));
  const brokenLinks = sections.flatMap(linksOf).filter((link) => isBrokenLinkAction(link, registry));
  const brokenIcons = sections.flatMap(tilesOf).filter(isLinkTile).filter((tile) => isBrokenIcon(tile, registry));
  return [
    ...unregistered.map((id) => `"${id}" is not a registered mini app`),
    ...brokenLinks.map((link) => `"${link.id}" actionValue "${link.actionValue}" is not valid for "${link.actionType}"`),
    ...brokenIcons.map((tile) => `"${tile.id}" icon must be exactly one emoji`),
  ];
}

export function loadHomeLayout(raw: unknown, registry: MiniAppRegistry): Readonly<HomeLayoutRaw> {
  const schema = homeLayoutFile.superRefine((layout, ctx) => {
    for (const message of registryIssues(layout, registry)) ctx.addIssue({ code: "custom", message });
  });
  return Object.freeze(parseConfigFile("home layout", schema, raw));
}

export function readHomeLayout(registry: MiniAppRegistry): Readonly<HomeLayoutRaw> {
  return loadHomeLayout(JSON.parse(fs.readFileSync(HOME_LAYOUT_FILE, "utf8")), registry);
}
