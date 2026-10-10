import { z } from "zod";
import { campusFilter } from "../building.schema";
import type { SkkuId } from "../building.types";

const INVALID_ID_MESSAGE = "skkuId must be a positive integer";

/** GET /building/list */
export const buildingListQuery = z.object({ campus: campusFilter });
export type BuildingListQuery = z.output<typeof buildingListQuery>;

/**
 * GET /building/:skkuId, read with parseInt as it always has been: "12abc" is
 * 12, and an id too long for a double is Infinity, which finds nothing (404).
 */
export const skkuIdParam = z
  .string()
  .transform((s) => parseInt(s, 10))
  .refine((id) => !Number.isNaN(id) && id >= 1, { error: INVALID_ID_MESSAGE })
  .transform((id) => id as SkkuId);
