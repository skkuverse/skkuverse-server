import { z } from "zod";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { CafeteriaDoc, CampusShapeDoc } from "./building.document";
import { CAMPUSES } from "./building.constants";
import { isBuildNo, isSkkuId, isSpaceCd } from "./building.rules";

const INVALID_CAMPUS_MESSAGE = "campus must be 'hssc' or 'nsc'";

const campus = z.enum(CAMPUSES, { error: INVALID_CAMPUS_MESSAGE });

export const campusFilter = z.preprocess((v) => (v === "" ? undefined : v), campus.optional());

const bilingual = z.object({ ko: z.string(), en: z.string() });

const geoPoint = z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) });

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

// CONTRACT(skkuverse-crawler): skkuverse-crawler/py/src/skkuverse_crawler/modules/campusmap/models.py writes
// `facilities`, so a cafeteria is parsed where it is read (ADR 0010, D2); one that fails is left out and logged.
export const cafeteriaDoc = z.object({
  _id: z.string().min(1),
  kind: z.literal("cafeteria"),
  campus,
  name: bilingual,
  buildNo: z.string().refine(isBuildNo),
  buildingName: bilingual,
  floor: bilingual.nullable(),
  floorCode: z.string().nullable(),
  spaceCd: z.string().refine(isSpaceCd).nullable(),
  location: geoPoint.nullable(),
}) satisfies z.ZodType<Omit<CafeteriaDoc, "syncedAt">>;
