import type { BuildingDoc } from "./building.document";

/** hssc = 인사캠, nsc = 자과캠. campusMap.do takes "1" | "2"; everything else uses these names. */
export type Campus = "hssc" | "nsc";

/** A bilingual text; a missing side is "". */
export interface BilingualText {
  ko: string;
  en: string;
}

/** A connection seen from one building (BuildingRepository.listConnectionsBySkkuId). */
export interface BuildingConnection {
  targetSkkuId: number;
  targetBuildNo: string | null;
  targetDisplayNo: string | null;
  targetName: BilingualText;
  fromFloor: BilingualText;
  toFloor: BilingualText;
}

/** One floor of a building with its spaces (GET /building/:skkuId `floors`). */
export interface FloorSpace {
  spaceCd: string;
  name: BilingualText;
  conspaceCd?: string | null;
}
export interface FloorGroup {
  floor: BilingualText;
  spaces: FloorSpace[];
}

export type WithCampusLabel<T> = T & { campusLabel: string };

export interface SpaceGroupItem {
  spaceCd: string;
  name: BilingualText;
  floor: BilingualText;
}

/** The search's rooms, grouped by building in row (relevance) order. */
export interface SpaceGroup {
  skkuId: number | null;
  buildNo: string;
  displayNo: string | null;
  campus: Campus;
  campusLabel: string;
  buildingName: BilingualText | undefined;
  items: SpaceGroupItem[];
}

/** Per-campus totals for a keyword, whatever the campus filter (the app's campus toggle). */
export interface SearchCounts {
  hssc: number;
  nsc: number;
  total: number;
}

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

/** GET /building/:skkuId */
export interface BuildingDetail {
  building: WithCampusLabel<BuildingDoc>;
  floors: FloorGroup[];
  connections: BuildingConnection[];
}
