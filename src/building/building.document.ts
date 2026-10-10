import type { ObjectId } from "mongodb";
import type { OverlayGeometry } from "../shared/geojson.types";
import type { BilingualText, BuildNo, Campus, DisplayNo, SkkuId, SpaceCd } from "./building.types";

/** GeoJSON order, [lng, lat], as the 2dsphere index requires. */
export interface GeoPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface BuildingImage {
  url: string | null;
  filename: string | null;
}

export interface BuildingSyncStamps {
  listAt?: Date;
  detailAt?: Date | null;
  detailError?: string | null;
}

export type SpaceSource = "buildInfo" | "spaceList";

export interface BuildingRawDoc {
  _id: SkkuId;
  /** SKKU gives a facility (a gate, an outbuilding) no number. */
  buildNo: BuildNo | null;
  campus: Campus;
  name: BilingualText;
  description: BilingualText;
  location: GeoPoint;
  image: BuildingImage;
  accessibility: { elevator: boolean; toilet: boolean };
  /** Absent on a facility, which phase 2 never fetches; [] when SKKU lists no photos. */
  attachments?: BuildingAttachment[];
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: BuildingSyncStamps;
}

/**
 * A known status, or SKKU's raw text when it is not one of them. `string & {}`
 * keeps the known names in the type, where a plain `| string` absorbs them.
 */
export type ElevatorStatus = "arrival" | "arrival_button" | "none" | "not_operating" | (string & {});

export interface BarrierFreeSection {
  label: string | null;
  ramp: { available: boolean; note: string | null } | null;
  toilet: { raw: string; count: number | null } | null;
  elevator: {
    raw: string;
    total: number | null;
    accessible: number | null;
  } | null;
  elevatorStatus: ElevatorStatus | null;
  parking: number | null;
}

/** Parsed from the barrier-free block SKKU writes into description.ko: one section per wing label (A동, B동), or one. */
export interface AccessibilityDetail {
  sections: BarrierFreeSection[];
  /** The block was there but yielded no section. */
  parseError?: string;
}

export interface BuildingAttachment {
  id: number;
  url: string | null;
  filename: string | null;
  alt: string;
}

export interface BuildingDoc {
  _id: SkkuId;
  buildNo: BuildNo | null;
  displayNo: DisplayNo | null;
  type: "building" | "facility";
  campus: Campus;
  name: BilingualText;
  description: BilingualText;
  location: GeoPoint;
  image: BuildingImage;
  attachments?: BuildingAttachment[];
  accessibility: {
    elevator: boolean;
    toilet: boolean;
    detail: AccessibilityDetail | null;
  };
  enrichVersion?: number;
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: BuildingSyncStamps;
  updatedAt?: Date;
  extensions?: Record<string, unknown>;
}

export interface SpaceDoc {
  _id?: ObjectId;
  spaceCd: SpaceCd;
  buildNo: BuildNo;
  campus: Campus;
  floor: BilingualText;
  name: BilingualText;
  buildingName?: BilingualText;
  conspaceCd: string | null;
  sources?: SpaceSource[];
  syncedAt?: Date;
}

/** A passage between two buildings, hand-authored by scripts/seed-connections.js; a and b are unordered. */
export interface ConnectionDoc {
  _id?: ObjectId;
  campus: Campus;
  a: ConnectionEnd;
  b: ConnectionEnd;
}

export interface ConnectionEnd {
  skkuId: SkkuId;
  floor: BilingualText;
}

// Written by scripts/import-campus-shapes.js. Why its own collection and not a
// field on buildings: docs/explanation/map-architecture.md, "Campus shapes".
export interface CampusShapeDoc {
  /** An authored slug ("hssc-boundary"), not an ObjectId. */
  _id: string;
  campus: Campus;
  /** A BASE_LAYERS id, with no category table between (map-architecture.md, "Campus shapes"). */
  layerId: string;
  /** [lng, lat], served verbatim. */
  geometry: OverlayGeometry;
  title: BilingualText;
  subtitle?: BilingualText | null;
  /** null for a boundary, lawn or path. The map gives a footprint the same tap as the building's pin. */
  skkuId: SkkuId | null;
  order: number;
}
