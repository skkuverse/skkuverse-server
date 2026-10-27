import { z } from "zod";
import { CAMPUSES } from "../building.constants";
import { storedSpace } from "../building.schema";
import type { PlaceSpace } from "./building-place.document";

const campus = z.enum(CAMPUSES);

const extraFacility = z.strictObject({
  campus,
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.strictObject({ ko: z.string().min(1), en: z.string().min(1) }),
});

export const placeLexiconFile = z.strictObject({
  facilitySlugs: z.record(z.string().regex(/^\d+$/), z.string().regex(/^[a-z0-9-]+$/)),
  extraFacilities: z.array(extraFacility),
});

export type PlaceLexicon = z.output<typeof placeLexiconFile>;

export const placeSpace = storedSpace.pick({
  spaceCd: true,
  buildNo: true,
  campus: true,
  floor: true,
  name: true,
  buildingName: true,
}) satisfies z.ZodType<PlaceSpace>;
