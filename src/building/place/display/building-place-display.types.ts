import type { BuildNo, Campus } from "../../building.types";
import type { PinnedPlace } from "../building-place.types";

export interface PlaceDisplay { name: string; code?: string }

export interface CampusPrimaryPlace { campus: Campus; placeIndex: number; otherCount: number }

export interface CampusBuilding { campus: Campus; buildNo: BuildNo }

/** WHY: what a stored place id names; a space id carries no buildNo, which the index finds from its spaceCd. */
export type StoredPlace = Exclude<PinnedPlace, { kind: "space" }> | Omit<Extract<PinnedPlace, { kind: "space" }>, "buildNo">;
