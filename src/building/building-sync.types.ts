import type { BuildingAttachment, BuildingRawDoc } from "./building.document";
import type { BilingualText, Campus } from "./building.types";

// What BuildingClient translates campusMap.do into.

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
