import type { BuildingDoc, SpaceDoc } from "../building.document";

export type PlaceBuilding = Pick<BuildingDoc, "_id" | "buildNo" | "campus" | "name">;

export type PlaceSpace = Pick<SpaceDoc, "spaceCd" | "buildNo" | "campus" | "floor" | "name" | "buildingName">;
