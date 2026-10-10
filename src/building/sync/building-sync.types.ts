import type {
  AccessibilityDetail,
  BuildingAttachment,
  BuildingDoc,
  BuildingImage,
  BuildingRawDoc,
  GeoPoint,
} from "../building.document";
import type { ApiId, BilingualText, BuildNo, Campus, DisplayNo, SkkuId, SpaceCd, WithBuildNo } from "../building.types";

export interface ListedBuilding {
  skkuId: SkkuId;
  apiId: ApiId;
  doc: Omit<BuildingRawDoc, "_id">;
}

export type ListedBuildingWithBuildNo = ListedBuilding & { doc: WithBuildNo<ListedBuilding["doc"]> };

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

export interface BuildInfo {
  attachments: BuildingAttachment[];
  spaces: SyncedSpace[];
}
