import type { Brand } from "../shared/brand.types";
import type { BuildingDoc } from "./building.document";

/** SKKU's building id: `_id` in buildings and buildings_raw, and the ends of a connection. */
export type SkkuId = Brand<number, "SkkuId">;

/** SKKU's building number ("227"). A facility has none. */
export type BuildNo = Brand<string, "BuildNo">;

/** The number shown to users, derived from a BuildNo by toDisplayNo. */
export type DisplayNo = Brand<string, "DisplayNo">;

/** A room code. */
export type SpaceCd = Brand<string, "SpaceCd">;

/** The building id exactly as buildList sent it; buildInfo takes it back verbatim. */
export type ApiId = Brand<string, "ApiId">;

/** hssc = 인사캠, nsc = 자과캠. campusMap.do takes "1" | "2"; everything else uses these names. */
export type Campus = "hssc" | "nsc";

/** A bilingual text; a missing side is "". */
export interface BilingualText {
  ko: string;
  en: string;
}

/** A connection seen from one building (BuildingRepository.listConnectionsBySkkuId). */
export interface BuildingConnection {
  targetSkkuId: SkkuId;
  targetBuildNo: BuildNo | null;
  targetDisplayNo: DisplayNo | null;
  targetName: BilingualText;
  fromFloor: BilingualText;
  toFloor: BilingualText;
}

/** One floor of a building with its spaces (GET /building/:skkuId `floors`). */
export interface FloorSpace {
  spaceCd: SpaceCd;
  name: BilingualText;
  conspaceCd?: string | null;
}
export interface FloorGroup {
  floor: BilingualText;
  spaces: FloorSpace[];
}

export type WithCampusLabel<T> = T & { campusLabel: string };

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
