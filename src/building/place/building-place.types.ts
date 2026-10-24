import type { BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";

export type UnresolvedReason = "online" | "offcampus" | "campusOnly" | "unknown";

export type PinnedPlace =
  | { kind: "space"; campus: Campus; spaceCd: SpaceCd; buildNo: BuildNo }
  | { kind: "building"; campus: Campus; buildNo: BuildNo }
  | { kind: "facility"; campus: Campus; slug: string };

export interface UnresolvedPlace { kind: "unresolved"; reason: UnresolvedReason; campus: Campus | null }

export type ResolvedPlace = PinnedPlace | UnresolvedPlace;

export type PlaceId = `${PinnedPlace["kind"]}:${Campus}:${string}`;

export interface IndexedSpace { spaceCd: SpaceCd; buildNo: BuildNo; campus: Campus; floor: string; name: string; roomKeys: readonly string[] }

/** WHY: `key` is the buildNo of a building and `<campus>:<slug>` of a facility, the form alias targets name. */
export interface IndexedPlace { key: string; campus: Campus; name: string; buildNo: BuildNo | null; slug: string | null }

export interface PlaceAlias { text: string; targets: readonly string[]; isWeak: boolean; needsBoundary: boolean; isWord: boolean }

export interface PlaceArea { text: string; isWord: boolean; campus: Campus | null }

export interface PlacePatterns {
  campusPhrases: ReadonlyArray<{ campus: Campus; pattern: RegExp }>;
  areas: readonly PlaceArea[];
  boardCampusBySource: ReadonlyMap<string, Campus>;
  boardBuildNoBySource: ReadonlyMap<string, string>;
  skkuMarker: RegExp;
  online: RegExp;
  offcampusStrong: RegExp;
  offcampusPlace: RegExp;
  offcampusWeak: RegExp;
  notPlace: RegExp;
}

export interface PlaceIndex {
  placeByKey: ReadonlyMap<string, IndexedPlace>;
  spacesByCd: ReadonlyMap<string, readonly IndexedSpace[]>;
  spacesByBuildNo: ReadonlyMap<string, readonly IndexedSpace[]>;
  prefixByBuildNo: ReadonlyMap<string, string>;
  aliases: readonly PlaceAlias[];
  officeSpacesByKey: ReadonlyMap<string, readonly IndexedSpace[]>;
  roomKeys: ReadonlySet<string>;
  roomAliases: ReadonlyArray<{ text: string; space: IndexedSpace }>;
  patterns: PlacePatterns;
  unpinnedFacilities: readonly SkkuId[];
  droppedAliases: readonly string[];
}
