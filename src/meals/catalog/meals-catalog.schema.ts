import { z } from "zod";
import { cafeteriaCampus } from "../meals.schema";

export const cafeteriaListQuery = z.object({ campus: cafeteriaCampus });
export type CafeteriaListQuery = z.output<typeof cafeteriaListQuery>;
