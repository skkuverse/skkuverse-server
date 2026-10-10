import { z } from "zod";

const INVALID_CAMPUS = "campus must be 'hssc' or 'nsc'";
const MISSING_QUERY = "q parameter is required";
const INVALID_ID = "skkuId must be a positive integer";

/** `campus` is optional; an empty value means no filter. */
const campus = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.enum(["hssc", "nsc"], { error: INVALID_CAMPUS }).optional(),
);

/** GET /building/list */
export const buildingListQuery = z.object({ campus });
export type BuildingListQuery = z.output<typeof buildingListQuery>;

/** GET /building/search. `q` is declared first, so a request failing both reports MISSING_QUERY. */
export const buildingSearchQuery = z.object({
  q: z.string({ error: MISSING_QUERY }).trim().min(1, { error: MISSING_QUERY }),
  campus,
});
export type BuildingSearchQuery = z.output<typeof buildingSearchQuery>;

/**
 * GET /building/:skkuId, read with parseInt as it always has been: "12abc" is
 * 12, and an id too long for a double is Infinity, which finds nothing (404).
 */
export const skkuIdParam = z
  .string()
  .transform((s) => parseInt(s, 10))
  .refine((id) => !Number.isNaN(id) && id >= 1, { error: INVALID_ID });
