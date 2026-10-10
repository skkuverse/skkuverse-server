import type { BuildingDoc } from "../building.document";
import type { BilingualText, BuildNo, DisplayNo, SkkuId, SpaceCd, WithCampusLabel } from "../building.types";

/** A connection seen from one building (GET /building/:skkuId `connections`). */
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

/** GET /building/:skkuId */
export interface BuildingDetail {
  building: WithCampusLabel<BuildingDoc>;
  floors: FloorGroup[];
  connections: BuildingConnection[];
}
