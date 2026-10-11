import { z } from "zod";

export const bilingualText = z.object({
  ko: z.string(),
  en: z.string(),
});

const barrierFreeSection = z.object({
  label: z.string().nullable(),
  ramp: z.object({ available: z.boolean(), note: z.string().nullable() }).nullable(),
  toilet: z.object({ raw: z.string(), count: z.int().nullable() }).nullable(),
  elevator: z
    .object({
      raw: z.string(),
      total: z.int().nullable(),
      accessible: z.int().nullable(),
    })
    .nullable(),
  /** WHY: a known status name, or SKKU's raw text when it matches none. */
  elevatorStatus: z.string().nullable(),
  parking: z.int().nullable(),
});

/** WHY: a building as list, detail and search serve it: the stored document plus `campusLabel`. */
export const buildingCard = z.object({
  _id: z.int(),
  /** QUIRK(skku): null for a facility, which has no number. */
  buildNo: z.string().nullable(),
  displayNo: z.string().nullable(),
  type: z.enum(["building", "facility"]),
  campus: z.enum(["hssc", "nsc"]),
  campusLabel: z.string(),
  name: bilingualText,
  description: bilingualText,
  /** QUIRK(mongo): GeoJSON order, [lng, lat]. */
  location: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) }),
  image: z.object({ url: z.string().nullable(), filename: z.string().nullable() }),
  attachments: z
    .array(
      z.object({
        id: z.int(),
        url: z.string().nullable(),
        filename: z.string().nullable(),
        alt: z.string(),
      }),
    )
    .optional(),
  accessibility: z.object({
    elevator: z.boolean(),
    toilet: z.boolean(),
    detail: z.object({ sections: z.array(barrierFreeSection), parseError: z.string().optional() }).nullable(),
  }),
  /** QUIRK(skku): SKKU's own stamps, passed through with their `+00:00` offset. */
  skkuCreatedAt: z.iso.datetime({ offset: true }).nullable(),
  skkuUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime().optional(),
});

export type BuildingCard = z.input<typeof buildingCard>;
