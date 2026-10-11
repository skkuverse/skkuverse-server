import { z } from "zod";
import { campusFilter } from "../building.schema";
import { isSkkuId } from "../building.rules";

const INVALID_ID_MESSAGE = "skkuId must be a positive integer";

export const buildingListQuery = z.object({ campus: campusFilter });
export type BuildingListQuery = z.output<typeof buildingListQuery>;

/** WHY: parseInt is the route's contract: "12abc" reads as 12, and an id parseInt cannot hold exactly is a 400. */
export const skkuIdParam = z
  .string()
  .transform((s) => parseInt(s, 10))
  .refine(isSkkuId, { error: INVALID_ID_MESSAGE });
