import { z } from "zod";
import { CAFETERIA_CAMPUSES } from "./meals-catalog.constants";

const INVALID_CAMPUS_MESSAGE = "campus must be 'hssc' or 'nsc'";

export const cafeteriaListQuery = z.object({ campus: z.enum(CAFETERIA_CAMPUSES, { error: INVALID_CAMPUS_MESSAGE }) });
export type CafeteriaListQuery = z.output<typeof cafeteriaListQuery>;
