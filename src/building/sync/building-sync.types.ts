import type {
  AccessibilityDetail,
  BuildingAttachment,
  BuildingDoc,
  BuildingImage,
  BuildingRawDoc,
  GeoPoint,
} from "../building.document";
import type { ApiId, BilingualText, BuildNo, Campus, DisplayNo, SkkuId, SpaceCd, WithBuildNo } from "../building.types";

// What BuildingSyncClient translates campusMap.do into.

/** One building from buildList. */
export interface ListedBuilding {
  skkuId: SkkuId;
  /** The id as SKKU sent it; buildInfo takes it back verbatim. */
  apiId: ApiId;
  doc: Omit<BuildingRawDoc, "_id">;
}

/** A listed building that has a buildInfo to fetch. */
export type ListedBuildingWithBuildNo = ListedBuilding & { doc: WithBuildNo<ListedBuilding["doc"]> };

/** A space as either listing reports it. */
export interface SyncedSpace {
  spaceCd: SpaceCd;
  buildNo: BuildNo;
  campus: Campus;
  floor: BilingualText;
  name: BilingualText;
  buildingName: BilingualText;
  /** Only spaceList reports it; buildInfo leaves it null. */
  conspaceCd: string | null;
}

/**
 * What enrichment derives from a raw building. BuildingSyncRepository writes
 * it over the enriched layer field by field, so fields it does not name (the
 * sync stamps, extensions) survive.
 */
export interface EnrichedBuilding {
  buildNo: BuildNo | null;
  displayNo: DisplayNo | null;
  type: BuildingDoc["type"];
  campus: Campus;
  name: BilingualText;
  description: BilingualText;
  location: GeoPoint;
  image: BuildingImage;
  attachments: BuildingAttachment[];
  accessibility: { elevator: boolean; toilet: boolean; detail: AccessibilityDetail | null };
  enrichVersion: number;
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
}

/** One building's buildInfo: its photos and the spaces on its floors. */
export interface BuildInfo {
  attachments: BuildingAttachment[];
  spaces: SyncedSpace[];
}
