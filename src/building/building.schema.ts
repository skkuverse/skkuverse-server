import { z } from "zod";
import type { OverlayGeometry } from "../shared/geojson.types";
import { isDrawableGeometry } from "../shared/geojson.util";
import type { BuildingDoc, CafeteriaDoc, CampusShapeDoc, SpaceDoc } from "./building.document";
import { CAMPUSES } from "./building.constants";
import { withDisplayNo } from "./building.mapper";
import { isBuildNo, isSkkuId, isSpaceCd } from "./building.rules";
import { buildingCard } from "./building.wire";

const INVALID_CAMPUS_MESSAGE = "campus must be 'hssc' or 'nsc'";

const campus = z.enum(CAMPUSES, { error: INVALID_CAMPUS_MESSAGE });

export const campusFilter = z.preprocess((v) => (v === "" ? undefined : v), campus.optional());

const bilingual = z.object({ ko: z.string(), en: z.string() });

const skkuId = z.number().refine(isSkkuId);

const buildNo = z.string().refine(isBuildNo);

const spaceCd = z.string().refine(isSpaceCd);

// CONTRACT(scripts): scripts/import-campus-shapes.js writes campus_shapes, so it is parsed where it
// is read (ADR 0010, D2). A document that fails is left out and logged, not fatal to the map.
export const campusShapeDoc = z.object({
  _id: z.string(),
  campus,
  layerId: z.string(),
  geometry: z.custom<OverlayGeometry>(isDrawableGeometry),
  title: bilingual,
  subtitle: bilingual.nullish(),
  skkuId: skkuId.nullable(),
  order: z.number(),
}) satisfies z.ZodType<CampusShapeDoc>;

// CONTRACT(skkuverse-crawler): `FacilityDoc` of skkuverse-crawler/py/src/skkuverse_crawler/modules/campusmap/models.py writes
// `facilities`, so a cafeteria is parsed where it is read (ADR 0010, D2); one that fails is left out and logged.
export const cafeteriaDoc = z.object({
  _id: z.string().min(1),
  kind: z.literal("cafeteria"),
  campus,
  name: bilingual,
  buildNo,
  buildingName: bilingual,
  floor: bilingual.nullable(),
  floorCode: z.string().nullable(),
  spaceCd: spaceCd.nullable(),
  location: buildingCard.shape.location.nullable(),
}) satisfies z.ZodType<Omit<CafeteriaDoc, "syncedAt">>;

// CONTRACT(skkuverse-crawler): `EnrichedBuilding` and `Space` of skkuverse-crawler/py/src/skkuverse_crawler/modules/campusmap/models.py
// write `buildings` and `spaces`. Read tolerantly (ADR 0010, D2): SKKU's stamps as any string.
export const storedBuilding = buildingCard.omit({ campusLabel: true, displayNo: true }).extend({
  _id: skkuId,
  buildNo: buildNo.nullable(),
  skkuCreatedAt: z.string().nullable(),
  skkuUpdatedAt: z.string().nullable(),
  updatedAt: z.date().optional(),
});

export const buildingDoc = storedBuilding.transform(withDisplayNo) satisfies z.ZodType<BuildingDoc>;

export const storedSpace = z.object({
  spaceCd: spaceCd.nullable(),
  buildNo,
  campus,
  floor: bilingual,
  name: bilingual,
  buildingName: bilingual.optional(),
  conspaceCd: z.string().nullable(),
}) satisfies z.ZodType<Omit<SpaceDoc, "_id" | "sources" | "syncedAt">>;
