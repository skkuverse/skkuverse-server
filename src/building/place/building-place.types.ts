import type { BuildNo, Campus, SkkuId, SpaceCd } from "../building.types";

export type UnresolvedReason = "online" | "offcampus" | "campusOnly" | "unknown";

export type PinnedPlace =
  | { kind: "space"; campus: Campus; spaceCd: SpaceCd; buildNo: BuildNo }
  | { kind: "building"; campus: Campus; buildNo: BuildNo }
  | { kind: "facility"; campus: Campus; slug: string };

export interface UnresolvedPlace { kind: "unresolved"; reason: UnresolvedReason; campus: Campus | null }

export type ResolvedPlace = PinnedPlace | UnresolvedPlace;

export type PlaceId = `${PinnedPlace["kind"]}:${Campus}:${string}`;

export interface IndexedSpace { spaceCd: SpaceCd; buildNo: BuildNo; campus: Campus }

/** WHY: `key` is the buildNo of a building and `<campus>:<slug>` of a facility. */
export interface IndexedPlace { key: string; campus: Campus; name: string; buildNo: BuildNo | null; slug: string | null }

export interface PlaceIndex {
  placeByKey: ReadonlyMap<string, IndexedPlace>;
  spacesByCd: ReadonlyMap<string, readonly IndexedSpace[]>;
  unpinnedFacilities: readonly SkkuId[];
}
