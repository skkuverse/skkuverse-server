import { z } from "zod";
import { bilingualText, buildingCard } from "../building.wire";

const spaceGroup = z.object({
  /** WHY: null when no building carries the space's `buildNo`; the app then ignores the tap. */
  skkuId: z.int().nullable(),
  buildNo: z.string(),
  displayNo: z.string().nullable(),
  campus: buildingCard.shape.campus,
  campusLabel: z.string(),
  buildingName: bilingualText.optional(),
  items: z.array(
    z.object({
      /** QUIRK(skku): two production spaces have no code; they are served as stored. */
      spaceCd: z.string().nullable(),
      name: bilingualText,
      floor: bilingualText,
    }),
  ),
});

/** WHY: per campus whatever `campus` asked for, so the app's campus toggle shows both. */
const searchCounts = z.object({
  hssc: z.int(),
  nsc: z.int(),
  total: z.int(),
});

const searchLimit = z.object({
  limit: z.int(),
  total: z.int(),
  truncated: z.boolean(),
});

export const buildingSearchData = z.object({
  buildings: z.array(buildingCard),
  spaces: z.array(spaceGroup),
});

export const buildingSearchMeta = z.object({
  keyword: z.string(),
  buildingCount: z.int(),
  spaceCount: z.int(),
  counts: z.object({ building: searchCounts, space: searchCounts }),
  limits: z.object({ building: searchLimit, space: searchLimit }),
});

export type BuildingSearchData = z.input<typeof buildingSearchData>;
export type BuildingSearchMeta = z.input<typeof buildingSearchMeta>;
