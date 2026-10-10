import type { ObjectId } from "mongodb";
import type { OverlayGeometry } from "../shared/geojson.types";
import type { BuildNo, Campus, DisplayNo, SkkuId, SpaceCd } from "./building.types";

/** One type per collection in the building DB, and the shapes they nest. */

/**
 * buildings_raw: SKKU's buildList entry in our shape, before enrichment. A
 * null buildNo marks a facility (type "facility" once enriched). The sync
 * fills `sync` phase by phase.
 */
export interface BuildingRawDoc {
  /** The SKKU id. */
  _id: SkkuId;
  buildNo: BuildNo | null;
  campus: Campus;
  name: { ko: string; en: string };
  description: { ko: string; en: string };
  /** GeoJSON Point, [lng, lat] (the 2dsphere order). */
  location: {
    type: "Point";
    coordinates: [number, number];
  };
  image: { url: string | null; filename: string | null };
  accessibility: { elevator: boolean; toilet: boolean };
  /** Written by sync phase 2 (buildInfo); [] for a building without photos. */
  attachments?: BuildingAttachment[];
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: { listAt?: Date; detailAt?: Date | null; detailError?: string | null };
}

// Barrier-free details, parsed from the "*배리어프리 편의시설 안내" block of description.ko. A building
// with several wings has one section per label (A동, B동); otherwise one.
// `parseError` means the block was found but yielded no sections.

/** A known status, or SKKU's raw text when it is not one of them. */
export type ElevatorStatus =
  | "arrival"
  | "arrival_button"
  | "none"
  | "not_operating"
  | string;

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

export interface AccessibilityDetail {
  sections: BarrierFreeSection[];
  parseError?: string;
}

export interface BuildingAttachment {
  id: string;
  url: string | null;
  filename: string | null;
  alt: string;
}

/**
 * buildings: the raw layer plus derived fields, as read. (enrichBuilding
 * writes it as a dot-path $set.) `sync`, `updatedAt` and `extensions` are
 * projected out of most reads.
 */
export interface BuildingDoc {
  _id: SkkuId;
  buildNo: BuildNo | null;
  displayNo: DisplayNo | null;
  /** A facility has no buildNo (an outbuilding, a gate). */
  type: "building" | "facility";
  campus: Campus;
  name: { ko: string; en: string };
  description: { ko: string; en: string };
  location: { type: "Point"; coordinates: [number, number] };
  image: { url: string | null; filename: string | null };
  attachments?: BuildingAttachment[];
  accessibility: {
    elevator: boolean;
    toilet: boolean;
    detail: AccessibilityDetail | null;
  };
  enrichVersion?: number;
  skkuCreatedAt: string | null;
  skkuUpdatedAt: string | null;
  sync?: { listAt?: Date; detailAt?: Date | null; detailError?: string | null };
  updatedAt?: Date;
  extensions?: Record<string, unknown>;
}

/**
 * spaces: unique on (spaceCd, buildNo, campus). `sources` accumulates which
 * listing reported the space: buildInfo (sync phase 2) and/or spaceList (3).
 */
export interface SpaceDoc {
  _id?: ObjectId;
  spaceCd: SpaceCd;
  buildNo: BuildNo;
  campus: Campus;
  floor: { ko: string; en: string };
  name: { ko: string; en: string };
  buildingName?: { ko: string; en: string };
  conspaceCd: string | null;
  sources?: Array<"buildInfo" | "spaceList">;
  syncedAt?: Date;
}

/**
 * connections: a passage between two buildings (an underground walkway). It
 * is undirected; looked up from either side, that side's floor is `fromFloor`
 * (toConnectionItems in building.mapper.ts).
 */
export interface ConnectionDoc {
  _id?: ObjectId;
  campus: Campus;
  a: { skkuId: SkkuId; floor: { ko: string; en: string } };
  b: { skkuId: SkkuId; floor: { ko: string; en: string } };
}

/**
 * Permanent campus geometry: building footprints, the campus boundary, walking
 * paths. Hand-authored, imported by `scripts/import-campus-shapes.js`.
 *
 * A SIBLING COLLECTION rather than a field on `buildings`, for two reasons.
 * `buildings` is a mirror of SKKU's campusMap.do, re-synced on
 * `BUILDING_SYNC_INTERVAL_MS`, so its document shape is owned by
 * the building sync and not by us — hand-authored geometry there survives
 * today's field-level `$set` but not one change to `replaceOne`. And decisively,
 * a campus boundary or a walking path has no building `_id` to hang off, so a
 * `footprint` field could only ever cover half of what this holds.
 *
 * It lives in the building DB because that is where campus-permanent data
 * belongs; `connections` set the precedent for a hand-authored collection
 * alongside the synced ones.
 */
export interface CampusShapeDoc {
  /** HUMAN-AUTHORED slug, as MapPlaceDoc. "hssc-boundary", "bldg-2-footprint". */
  _id: string;
  campus: Campus;
  /**
   * Targets a BASE_LAYERS entry directly — there is no category table on this
   * side. `presentationFor` exists so ops can invent a category mid-festival;
   * permanent geometry has no such need, and the base layer list is repo
   * TypeScript either way. An id naming no layer is dropped and counted.
   */
  layerId: string;
  /** GeoJSON, [lng, lat]. Served verbatim — see MapPlaceDoc.location. */
  geometry: OverlayGeometry;
  title: { ko: string; en: string };
  subtitle?: { ko: string; en: string } | null;
  /**
   * The building this shape outlines, or `null` for geometry that is not a
   * building — a boundary, a lawn, a path.
   *
   * Projected to `tap: { kind: "skku_building", placeId: String(skkuId) }`, so
   * tapping a footprint opens exactly the sheet its number pin opens. No join
   * and no new `MarkerTap` kind: one addressing scheme, as ADR 0004 requires.
   */
  skkuId: SkkuId | null;
  order: number;
  updatedAt: Date;
}
