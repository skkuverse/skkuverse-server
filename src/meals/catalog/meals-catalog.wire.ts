import { z } from "zod";
import { CAFETERIA_CAMPUSES } from "../meals.constants";

const bilingualText = z.object({ ko: z.string(), en: z.string() });

const cafeteriaBuilding = z.object({
  skkuId: z.int(),
  buildNo: z.string(),
  displayNo: z.string().nullable(),
  name: bilingualText,
});

const cafeteria = z.object({
  /** CONTRACT(skkuverse-crawler): SKKU's conspaceCd, the cafeteria id skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/models.py stores. */
  id: z.string(),
  campus: z.enum(CAFETERIA_CAMPUSES),
  name: bilingualText,
  /** WHY: null when no stored building has the cafeteria's buildNo. */
  building: cafeteriaBuilding.nullable(),
  floor: bilingualText.nullable(),
  spaceCd: z.string().nullable(),
  /** QUIRK(mongo): GeoJSON order, [lng, lat]; null when SKKU gives no coordinates. */
  location: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }).nullable(),
});

export const cafeteriaList = z.object({
  cafeterias: z.array(cafeteria),
});

export type CafeteriaList = z.input<typeof cafeteriaList>;
