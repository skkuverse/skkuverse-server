import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "../building.document";

export type ConnectionEnds = Pick<ConnectionDoc, "a" | "b">;

export type FloorSpaceDoc = Pick<SpaceDoc, "spaceCd" | "name" | "floor" | "conspaceCd">;

export type BuildingLabel = Pick<BuildingDoc, "_id" | "buildNo" | "displayNo" | "name">;
