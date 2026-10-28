import type { BuildNo, Campus, SkkuId, SpaceCd } from "../../building.types";
import type { PinnedPlace } from "../building-place.types";

/** WHY: the building sheet the campus map opens a place on, by its building's or facility's skkumap id, and the room in it. */
export interface PlaceMapTarget { skkuId: SkkuId; spaceCd: SpaceCd | null }

export interface PlaceDisplay { name: string; code?: string; mapTarget: PlaceMapTarget | null }

export interface CampusPrimaryPlace { campus: Campus; placeIndex: number; otherCount: number }

export interface CampusBuilding { campus: Campus; buildNo: BuildNo }

/** WHY: what a stored place id names; a space id carries no buildNo, which the index finds from its spaceCd. */
export type StoredPlace = Exclude<PinnedPlace, { kind: "space" }> | Omit<Extract<PinnedPlace, { kind: "space" }>, "buildNo">;
