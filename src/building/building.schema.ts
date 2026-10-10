import { z } from "zod";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { CampusShapeDoc } from "./building.document";
import type { SkkuId } from "./building.types";

const INVALID_CAMPUS = "campus must be 'hssc' or 'nsc'";
const INVALID_ID = "skkuId must be a positive integer";

/** `campus` is optional; an empty value means no filter. */
export const campusFilter = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.enum(["hssc", "nsc"], { error: INVALID_CAMPUS }).optional(),
);

/** GET /building/list */
export const buildingListQuery = z.object({ campus: campusFilter });
export type BuildingListQuery = z.output<typeof buildingListQuery>;

/**
 * GET /building/:skkuId, read with parseInt as it always has been: "12abc" is
 * 12, and an id too long for a double is Infinity, which finds nothing (404).
 */
export const skkuIdParam = z
  .string()
  .transform((s) => parseInt(s, 10))
  .refine((id) => !Number.isNaN(id) && id >= 1, { error: INVALID_ID })
  .transform((id) => id as SkkuId);

const bilingual = z.object({ ko: z.string(), en: z.string() });

/**
 * A `campus_shapes` document as the campus overlay reads it. The collection is
 * written outside src/ (scripts/import-campus-shapes.js) and cached, so it is
 * parsed where it is read (ADR 0010, D2): only the fields read are checked,
 * unknown ones are dropped, and a document that fails is left out and logged
 * rather than failing the map. The geometry check is the overlay's own
 * drawability guard, so a shape that passes here can be drawn.
 */
export const campusShapeDoc = z.object({
  _id: z.string(),
  campus: z.enum(["hssc", "nsc"]),
  layerId: z.string(),
  geometry: z.custom<OverlayGeometry>(isDrawableGeometry),
  title: bilingual,
  subtitle: bilingual.nullish(),
  skkuId: z
    .number()
    .int()
    .nullable()
    .transform((id) => id as SkkuId | null),
  order: z.number(),
}) satisfies z.ZodType<CampusShapeDoc>;
