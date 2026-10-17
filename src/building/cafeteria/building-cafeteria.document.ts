import type { GeoPoint } from "../building.document";
import type { BilingualText, BuildNo, Campus, SpaceCd } from "../building.types";

/** WHY: `facilities` mirrors SKKU's facility registry (sisulList), of which only cafeterias are kept. */
export interface CafeteriaDoc {
  /** QUIRK(skku): the registry's `conspaceCd`, also the cafeteria id on SKKU's menu page. */
  _id: string;
  kind: "cafeteria";
  campus: Campus;
  name: BilingualText;
  buildNo: BuildNo;
  buildingName: BilingualText;
  floor: BilingualText | null;
  floorCode: string | null;
  /** QUIRK(skku): absent on a few rows (20201040 and 20201104 on 2026-10-17). */
  spaceCd: SpaceCd | null;
  location: GeoPoint | null;
  syncedAt: Date;
}

export type SyncedCafeteria = Omit<CafeteriaDoc, "syncedAt">;
