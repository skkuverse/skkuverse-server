import type { BuildNo, Campus } from "../../building.types";

export interface PlaceDisplay { name: string; code?: string }

export interface CampusPrimaryPlace { campus: Campus; placeIndex: number; otherCount: number }

export interface CampusBuilding { campus: Campus; buildNo: BuildNo }
