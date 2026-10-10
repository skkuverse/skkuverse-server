import type { BuildingDoc } from "../building.document";
import type { BilingualText, BuildNo, Campus, DisplayNo, SkkuId, SpaceCd, WithCampusLabel } from "../building.types";

/** How a tier compares the query against a field. */
export type TierMode = "exact" | "prefix" | "substring";

export interface RelevanceTier {
  /** Higher wins. Spaced by 10 so a tier can be inserted without renumbering. */
  readonly score: number;
  /** Dotted document paths this tier inspects. */
  readonly paths: readonly string[];
  readonly mode: TierMode;
}

/** The one document a ranked search pipeline's $facet emits (building-search.query.ts). */
export type RankedFacet<T> = {
  strong: T[];
  weak: T[];
  counts: Array<{ _id: Campus | null; n: number }>;
  total: Array<{ n: number }>;
};

/** A ranked search's rows, with what the same predicate counted. */
export interface RankedSearchResult<T> {
  items: T[];
  /** Campus-agnostic per-campus totals for the same keyword predicate. */
  counts: SearchCounts;
  /** Campus-scoped size of the match set (>= items.length). */
  total: number;
  truncated: boolean;
}

export interface SpaceGroupItem {
  spaceCd: SpaceCd;
  name: BilingualText;
  floor: BilingualText;
}

/** The search's rooms, grouped by building in row (relevance) order. */
export interface SpaceGroup {
  skkuId: SkkuId | null;
  buildNo: BuildNo;
  displayNo: DisplayNo | null;
  campus: Campus;
  campusLabel: string;
  buildingName: BilingualText | undefined;
  items: SpaceGroupItem[];
}

/** Per-campus totals for a keyword, whatever the campus filter (the app's campus toggle). */
export type SearchCounts = Record<Campus, number> & { total: number };

export interface SearchLimit {
  limit: number;
  total: number;
  truncated: boolean;
}

/** GET /building/search: `data` and the extra `meta` the controller passes to withMeta. */
export interface BuildingSearch {
  data: { buildings: Array<WithCampusLabel<BuildingDoc>>; spaces: SpaceGroup[] };
  meta: {
    keyword: string;
    buildingCount: number;
    spaceCount: number;
    counts: { building: SearchCounts; space: SearchCounts };
    limits: { building: SearchLimit; space: SearchLimit };
  };
}

