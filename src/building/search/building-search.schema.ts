import { z } from "zod";
import { campusFilter } from "../building.schema";

const MISSING_QUERY = "q parameter is required";

/** GET /building/search. `q` is declared first, so a request failing both reports MISSING_QUERY. */
export const buildingSearchQuery = z.object({
  q: z.string({ error: MISSING_QUERY }).trim().min(1, { error: MISSING_QUERY }),
  campus: campusFilter,
});
export type BuildingSearchQuery = z.output<typeof buildingSearchQuery>;
