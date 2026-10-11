import type { BilingualText, BuildNo, DisplayNo, SkkuId, SpaceCd } from "../building.types";

export interface BuildingConnection {
  targetSkkuId: SkkuId;
  targetBuildNo: BuildNo | null;
  targetDisplayNo: DisplayNo | null;
  targetName: BilingualText;
  fromFloor: BilingualText;
  toFloor: BilingualText;
}

export interface FloorSpace {
  spaceCd: SpaceCd;
  name: BilingualText;
  conspaceCd?: string | null;
}

export interface FloorGroup {
  floor: BilingualText;
  spaces: FloorSpace[];
}
