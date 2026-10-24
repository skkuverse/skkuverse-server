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

// CONTRACT(skkuverse-crawler): `EnrichedBuilding` of skkuverse-crawler/py/src/skkuverse_crawler/modules/campusmap/models.py
// (SKKU buildList and buildInfo) plus its write's `sync`, `updatedAt` and `extensions`; `sync`, `enrichVersion` and `extensions` are never read.
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

// CONTRACT(skkuverse-crawler): `Space` of skkuverse-crawler/py/src/skkuverse_crawler/modules/campusmap/models.py (SKKU buildInfo
// and spaceList), keyed by the unique index on spaceCd, buildNo and campus it creates.
export interface SpaceDoc {
  _id?: ObjectId;
  // EVIDENCE: two skkumap_dev spaces carry spaceCd: null (synced 2026-09-24, blank names); prod had none on 2026-10-14.
  spaceCd: SpaceCd | null;
  buildNo: BuildNo;
  campus: Campus;
  floor: BilingualText;
  name: BilingualText;
  buildingName?: BilingualText;
  conspaceCd: string | null;
  sources?: SpaceSource[];
  syncedAt?: Date;
}

// CONTRACT(skkuverse-crawler): `FacilityDoc` of skkuverse-crawler/py/src/skkuverse_crawler/modules/campusmap/models.py,
// one per sisulList row in `facilities`; other rows are `kind: "facility"`, never read here. The fields this server
// reads from a `kind: "cafeteria"` row.
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
