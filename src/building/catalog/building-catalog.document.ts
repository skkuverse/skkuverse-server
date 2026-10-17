import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "../building.document";
import type { CafeteriaDoc } from "../cafeteria/building-cafeteria.document";

export type ConnectionEnds = Pick<ConnectionDoc, "a" | "b">;

export type FloorSpaceDoc = Pick<SpaceDoc, "spaceCd" | "name" | "floor" | "conspaceCd">;

export type CafeteriaSummary = Pick<CafeteriaDoc, "_id" | "name" | "floor" | "spaceCd">;

export type BuildingLabel = Pick<BuildingDoc, "_id" | "buildNo" | "displayNo" | "name">;
