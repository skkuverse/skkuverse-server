import fs from "fs";
import path from "path";
import { parseConfigFile } from "../../infra/config-file";
import { isBrokenLinkAction } from "../ui.rules";
import type { BannerImageRaw } from "../ui.schema";
import type { MiniAppRegistry } from "../ui.types";
import { homeLayoutFile, type HomeLayoutRaw, type TileRaw } from "./ui-home.schema";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const HOME_LAYOUT_FILE = path.join(__dirname, "home-layout.json");

type SectionRaw = HomeLayoutRaw["sections"][number];
type LinkTileRaw = Extract<TileRaw, { kind: "link" }>;
type IssuePath = Array<string | number>;

interface Located<T> {
  at: IssuePath;
  value: T;
}

const isLinkTile = (tile: Located<TileRaw>): tile is Located<LinkTileRaw> => tile.value.kind === "link";

function tilesOf({ at, value }: Located<SectionRaw>): Array<Located<TileRaw>> {
  return value.type === "tile_grid" ? value.tiles.map((tile, i) => ({ at: [...at, "tiles", i], value: tile })) : [];
}

function linksOf(section: Located<SectionRaw>): Array<Located<BannerImageRaw | LinkTileRaw>> {
  const { at, value } = section;
  const items = value.type === "banner_carousel" ? value.items : [];
  const images = items.flatMap((item, i) => (item.type === "image" ? [{ at: [...at, "items", i], value: item }] : []));
  return [...images, ...tilesOf(section).filter(isLinkTile)];
}

function miniAppIdsOf(section: Located<SectionRaw>): Array<Located<string>> {
  const { at, value } = section;
  if (value.type === "miniapp_feed") return [{ at: [...at, "miniAppId"], value: value.miniAppId }];
  return tilesOf(section).flatMap((tile) => (tile.value.kind === "miniapp" ? [{ at: [...tile.at, "id"], value: tile.value.id }] : []));
}

const isBrokenIcon = (tile: LinkTileRaw, registry: MiniAppRegistry): boolean =>
  tile.icon.kind === "emoji" && !registry.isSingleEmoji(tile.icon.emoji);

function registryIssues(layout: HomeLayoutRaw, registry: MiniAppRegistry): Array<{ path: IssuePath; message: string }> {
  const sections = layout.sections.map((value, i): Located<SectionRaw> => ({ at: ["sections", i], value }));
  const unregistered = sections.flatMap(miniAppIdsOf).filter((id) => !registry.map.has(id.value));
  const brokenLinks = sections.flatMap(linksOf).filter((link) => isBrokenLinkAction(link.value, registry));
  const brokenIcons = sections.flatMap(tilesOf).filter(isLinkTile).filter((tile) => isBrokenIcon(tile.value, registry));
  return [
    ...unregistered.map(({ at, value }) => ({ path: at, message: `"${value}" is not a registered mini app` })),
    ...brokenLinks.map(({ at, value: link }) => ({
      path: [...at, "actionValue"],
      message: `"${link.id}" actionValue "${link.actionValue}" is not valid for "${link.actionType}"`,
    })),
    ...brokenIcons.map(({ at, value }) => ({ path: [...at, "icon", "emoji"], message: `"${value.id}" icon must be exactly one emoji` })),
  ];
}

export function loadHomeLayout(raw: unknown, registry: MiniAppRegistry): Readonly<HomeLayoutRaw> {
  const schema = homeLayoutFile.superRefine((layout, ctx) => {
    for (const issue of registryIssues(layout, registry)) ctx.addIssue({ code: "custom", ...issue });
  });
  return Object.freeze(parseConfigFile("home layout", schema, raw));
}

export function readHomeLayout(registry: MiniAppRegistry): Readonly<HomeLayoutRaw> {
  return loadHomeLayout(JSON.parse(fs.readFileSync(HOME_LAYOUT_FILE, "utf8")), registry);
}
