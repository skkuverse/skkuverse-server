import { z } from "zod";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { CampusShapeDoc } from "./building.document";
import { CAMPUSES } from "./building.rules";
import type { SkkuId } from "./building.types";

const INVALID_CAMPUS = "campus must be 'hssc' or 'nsc'";

const campus = z.enum(CAMPUSES, { error: INVALID_CAMPUS });

/** `campus` is optional; an empty value means no filter. */
export const campusFilter = z.preprocess((v) => (v === "" ? undefined : v), campus.optional());

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
  campus,
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
