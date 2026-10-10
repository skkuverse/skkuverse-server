import type { BuildingDoc, ConnectionDoc, SpaceDoc } from "../building.document";

/** A connection's two ends: all the building detail reads of one. */
export type ConnectionEnds = Pick<ConnectionDoc, "a" | "b">;

/** The fields of a space that a building's floor list reads. */
export type FloorSpaceDoc = Pick<SpaceDoc, "spaceCd" | "name" | "floor" | "conspaceCd">;

/** A building's number and name: enough to label it from another building. */
export type BuildingLabel = Pick<BuildingDoc, "_id" | "buildNo" | "displayNo" | "name">;
