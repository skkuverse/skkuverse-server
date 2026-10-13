import type { ObjectId } from "mongodb";
import type { OverlayGeometry } from "../shared/geojson.types";
import type { BUILDING_TYPES } from "./building.constants";
import type { BilingualText, BuildNo, Campus, DisplayNo, SkkuId, SpaceCd } from "./building.types";

/** QUIRK(mongo): GeoJSON order, [lng, lat]: the 2dsphere index reads the first as longitude. */
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
  /** QUIRK(skku): a facility (a gate, an outbuilding) has no number. */
  buildNo: BuildNo | null;
  campus: Campus;
  name: BilingualText;
  description: BilingualText;
  location: GeoPoint;
  image: BuildingImage;
  accessibility: { elevator: boolean; toilet: boolean };
  /** WHY: absent on a facility, whose buildInfo is never fetched; [] when SKKU lists no photos. */
  attachments?: BuildingAttachment[];
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: BuildingSyncStamps;
}

/**
 * WHY: `string & {}` keeps the known names in the type, where a plain `| string` absorbs them;
 * any other value is SKKU's raw text.
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

/** QUIRK(skku): SKKU writes a barrier-free block into description.ko, one section per wing label (wing A, wing B) or one. */
export interface AccessibilityDetail {
  sections: BarrierFreeSection[];
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
  type: (typeof BUILDING_TYPES)[number];
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

/** CONTRACT(scripts): hand-authored by scripts/seed-connections.js; `a` and `b` are unordered. */
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

// CONTRACT(scripts): written by scripts/import-campus-shapes.js. Why a collection of its own and not a
// field on buildings: docs/how-to/configure-map-overlays.md ("Draw permanent campus geometry").
export interface CampusShapeDoc {
  _id: string;
  campus: Campus;
  /** SEE: docs/how-to/configure-map-overlays.md ("Draw permanent campus geometry"): a BASE_LAYERS id, no category table. */
  layerId: string;
  geometry: OverlayGeometry;
  title: BilingualText;
  subtitle?: BilingualText | null;
  /** WHY: null for a boundary, lawn or path; with an id, the map gives the footprint the building pin's tap. */
  skkuId: SkkuId | null;
  order: number;
}
