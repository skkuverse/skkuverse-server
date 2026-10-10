import type { BuildingAttachment, BuildingDoc, BuildingRawDoc } from "./building.document";

/** hssc = 인사캠, nsc = 자과캠. campusMap.do takes "1" | "2"; everything else uses these names. */
export type Campus = "hssc" | "nsc";

/** A bilingual text; a missing side is "". */
export interface BilingualText {
  ko: string;
  en: string;
}

// --- Responses ---

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

// --- Sync: what BuildingClient translates campusMap.do into ---

/** One building from buildList. */
export interface ListedBuilding {
  skkuId: number;
  /** The id as SKKU sent it; buildInfo takes it back verbatim. */
  apiId: string;
  doc: Omit<BuildingRawDoc, "_id">;
}

/** Which listing reported a space; recorded in its `sources`. */
export type SpaceSource = "buildInfo" | "spaceList";

/** A space as either listing reports it. */
export interface SyncedSpace {
  spaceCd: string;
  buildNo: string;
  campus: Campus;
  floor: BilingualText;
  name: BilingualText;
  buildingName: BilingualText;
  /** Only spaceList reports it; buildInfo leaves it null. */
  conspaceCd: string | null;
}

/** One building's buildInfo: its photos and the spaces on its floors. */
export interface BuildInfo {
  attachments: BuildingAttachment[];
  spaces: SyncedSpace[];
}

// --- Use-case results (BuildingService) ---

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
