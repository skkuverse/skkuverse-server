import type { BuildingDoc } from "../building.document";
import type { BilingualText, BuildNo, Campus, DisplayNo, SkkuId, SpaceCd, WithCampusLabel } from "../building.types";

export type TierMode = "exact" | "prefix" | "substring";

export interface RelevanceTier {
  /** Higher wins; spaced by 10 so a tier can be inserted between two. */
  readonly score: number;
  readonly paths: readonly string[];
  readonly mode: TierMode;
}

export type RankedFacet<T> = {
  strong: T[];
  weak: T[];
  counts: Array<{ _id: Campus | null; n: number }>;
  total: Array<{ n: number }>;
};

export interface RankedSearchResult<T> {
  items: T[];
  /** Campus-agnostic on purpose: the app's campus toggle shows both campuses. */
  counts: SearchCounts;
  /** Campus-scoped, unlike `counts`. */
  total: number;
  truncated: boolean;
}

export interface SpaceGroupItem {
  spaceCd: SpaceCd;
  name: BilingualText;
  floor: BilingualText;
}

export interface SpaceGroup {
  skkuId: SkkuId | null;
  buildNo: BuildNo;
  displayNo: DisplayNo | null;
  campus: Campus;
  campusLabel: string;
  buildingName: BilingualText | undefined;
  items: SpaceGroupItem[];
}

export type SearchCounts = Record<Campus, number> & { total: number };

export interface SearchLimit {
  limit: number;
  total: number;
  truncated: boolean;
}

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

