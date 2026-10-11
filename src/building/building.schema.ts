import { z } from "zod";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { CampusShapeDoc } from "./building.document";
import { CAMPUSES, isSkkuId } from "./building.rules";

const INVALID_CAMPUS_MESSAGE = "campus must be 'hssc' or 'nsc'";

const campus = z.enum(CAMPUSES, { error: INVALID_CAMPUS_MESSAGE });

export const campusFilter = z.preprocess((v) => (v === "" ? undefined : v), campus.optional());

const bilingual = z.object({ ko: z.string(), en: z.string() });

// CONTRACT(scripts): scripts/import-campus-shapes.js writes campus_shapes, so it is parsed where it
// is read (ADR 0010, D2). A document that fails is left out and logged, not fatal to the map.
export const campusShapeDoc = z.object({
  _id: z.string(),
  campus,
  layerId: z.string(),
  geometry: z.custom<OverlayGeometry>(isDrawableGeometry),
  title: bilingual,
  subtitle: bilingual.nullish(),
  skkuId: z.number().refine(isSkkuId).nullable(),
  order: z.number(),
}) satisfies z.ZodType<CampusShapeDoc>;
