import { isBrokenLinkAction } from "../../shared/link-action.util";
import { toMiniAppTargetReferences } from "../ui.rules";
import type { BannerImageRaw } from "../ui.schema";
import type { MiniAppRegistry, TargetGrammar } from "../ui.types";
import type { HomeLayoutRaw, TileRaw } from "./ui-home.schema";
import type { HomeLayoutIssue, HomeLayoutReference } from "./ui-home.types";

type SectionRaw = HomeLayoutRaw["sections"][number];
type LinkTileRaw = Extract<TileRaw, { kind: "link" }>;
type IssuePath = HomeLayoutIssue["path"];

interface Located<T> {
  at: IssuePath;
  value: T;
}

const isLinkTile = (tile: Located<TileRaw>): tile is Located<LinkTileRaw> => tile.value.kind === "link";

function tilesOf({ at, value }: Located<SectionRaw>): Array<Located<TileRaw>> {
  return value.type === "tile_grid" ? value.tiles.map((tile, i) => ({ at: [...at, "tiles", i], value: tile })) : [];
}

function bannersOf({ at, value }: Located<SectionRaw>): Array<Located<BannerImageRaw>> {
  const items = value.type === "banner_carousel" ? value.items : [];
  return items.flatMap((item, i) => (item.type === "image" ? [{ at: [...at, "items", i], value: item }] : []));
}

function linksOf(section: Located<SectionRaw>): Array<Located<BannerImageRaw | LinkTileRaw>> {
  return [...bannersOf(section), ...tilesOf(section).filter(isLinkTile)];
}

function miniAppIdsOf(section: Located<SectionRaw>): Array<Located<string>> {
  const { at, value } = section;
  if (value.type === "miniapp_feed") return [{ at: [...at, "miniAppId"], value: value.miniAppId }];
  return tilesOf(section).flatMap((tile) => (tile.value.kind === "miniapp" ? [{ at: [...tile.at, "id"], value: tile.value.id }] : []));
}

function locatedSections(layout: HomeLayoutRaw): Array<Located<SectionRaw>> {
  return layout.sections.map((value, i) => ({ at: ["sections", i], value }));
}

const isBrokenIcon = (tile: LinkTileRaw, registry: MiniAppRegistry): boolean =>
  tile.icon.kind === "emoji" && !registry.isSingleEmoji(tile.icon.emoji);

export function toHomeLayoutIssues(layout: HomeLayoutRaw, registry: MiniAppRegistry): HomeLayoutIssue[] {
  const sections = locatedSections(layout);
  const unregistered = sections.flatMap(miniAppIdsOf).filter((id) => !registry.isRegistered(id.value));
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

function targetReferences({ at, value: link }: Located<BannerImageRaw | LinkTileRaw>, grammar: TargetGrammar): HomeLayoutReference[] {
  return toMiniAppTargetReferences(link, [...at, "actionValue"], grammar);
}

function tileReferences(tile: Located<TileRaw>, grammar: TargetGrammar): HomeLayoutReference[] {
  if (isLinkTile(tile)) return targetReferences(tile, grammar);
  return tile.value.kind === "miniapp" ? [{ dataset: "miniapps", id: tile.value.id, path: [...tile.at, "id"] }] : [];
}

function sectionReferences(section: Located<SectionRaw>, grammar: TargetGrammar): HomeLayoutReference[] {
  const { at, value } = section;
  if (value.type === "miniapp_feed") return [{ dataset: "miniapps", id: value.miniAppId, path: [...at, "miniAppId"] }];
  if (value.type === "banner_carousel") return bannersOf(section).flatMap((banner) => targetReferences(banner, grammar));
  return tilesOf(section).flatMap((tile) => tileReferences(tile, grammar));
}

export function homeLayoutReferences(layout: HomeLayoutRaw, grammar: TargetGrammar): HomeLayoutReference[] {
  return locatedSections(layout).flatMap((section) => sectionReferences(section, grammar));
}

type EntryList = "tiles" | "items";

interface UnresolvedItem {
  section: number;
  entry?: { list: EntryList; index: number };
}

function toUnresolvedItem({ path }: HomeLayoutIssue): UnresolvedItem {
  const [root, section, list, index] = path;
  if (root !== "sections" || typeof section !== "number") throw new Error(`home layout issue path ${path.join(".")} names no section`);
  const isEntry = (list === "tiles" || list === "items") && typeof index === "number";
  return isEntry ? { section, entry: { list, index } } : { section };
}

function withoutEntries(section: SectionRaw, unresolved: readonly UnresolvedItem[]): SectionRaw | null {
  const isUnresolved = (list: EntryList, index: number): boolean => unresolved.some(({ entry }) => entry?.list === list && entry.index === index);
  if (unresolved.some(({ entry }) => entry === undefined)) return null;
  if (section.type === "banner_carousel") return { ...section, items: section.items.filter((_, i) => !isUnresolved("items", i)) };
  if (section.type !== "tile_grid") return section;
  const tiles = section.tiles.filter((_, i) => !isUnresolved("tiles", i));
  return tiles.length === 0 ? null : { ...section, tiles };
}

export function withoutUnresolvedItems(layout: HomeLayoutRaw, issues: readonly HomeLayoutIssue[]): HomeLayoutRaw {
  const unresolved = issues.map(toUnresolvedItem);
  const sections = layout.sections.flatMap((section, sectionIndex) => {
    const kept = withoutEntries(section, unresolved.filter((item) => item.section === sectionIndex));
    return kept === null ? [] : [kept];
  });
  return { ...layout, sections };
}
