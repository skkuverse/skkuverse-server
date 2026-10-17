import { z } from "zod";
import { CAFETERIA_CAMPUSES } from "./meals.constants";

const INVALID_CAMPUS_MESSAGE = "campus must be 'hssc' or 'nsc'";

export const cafeteriaCampus = z.enum(CAFETERIA_CAMPUSES, { error: INVALID_CAMPUS_MESSAGE });
