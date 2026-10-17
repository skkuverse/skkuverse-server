import { z } from "zod";
import { isBuildNo, isSpaceCd } from "../building.rules";

export const skkuSisulListResponse = z.object({ buildItems: z.array(z.unknown()) });

// QUIRK(skku): misspells longtitude, kept as sent; coordinates are numbers here, strings in buildList.
// Only what the mapping cannot do without is required (measured 2026-10-17).
export const skkuSisulListCafeteria = z.object({
  conspaceCd: z.string().regex(/^\d+$/),
  bizNm: z.string().min(1),
  bizNmEng: z.string().optional(),
  buildNo: z.string().refine(isBuildNo),
  buildNm: z.string().optional(),
  buildNmEng: z.string().optional(),
  floor: z.string().optional(),
  floorNm: z.string().optional(),
  floorNmEng: z.string().optional(),
  spaceCd: z.string().refine(isSpaceCd).optional(),
  latitude: z.number().optional(),
  longtitude: z.number().optional(),
});

export type SkkuSisulListCafeteria = z.output<typeof skkuSisulListCafeteria>;
