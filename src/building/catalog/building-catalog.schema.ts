import { z } from "zod";
import { campusFilter } from "../building.schema";
import type { SkkuId } from "../building.types";

const INVALID_ID_MESSAGE = "skkuId must be a positive integer";

export const buildingListQuery = z.object({ campus: campusFilter });
export type BuildingListQuery = z.output<typeof buildingListQuery>;

/** WHY: parseInt is the route's contract: "12abc" reads as 12, and an id too long for a double finds nothing (404). */
export const skkuIdParam = z
  .string()
  .transform((s) => parseInt(s, 10))
  .refine((id) => !Number.isNaN(id) && id >= 1, { error: INVALID_ID_MESSAGE })
  .transform((id) => id as SkkuId);
