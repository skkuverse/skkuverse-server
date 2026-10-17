import moment from "moment-timezone";
import { z } from "zod";
import { cafeteriaCampus } from "../meals.schema";
import { MEAL_CODES, PARSE_STATUSES, WEEKDAYS } from "./meals-menus.constants";
import type { MenuDoc } from "./meals-menus.document";

const INVALID_DATE_MESSAGE = "date must be a calendar date, YYYY-MM-DD";

const calendarDate = z
  .string({ error: INVALID_DATE_MESSAGE })
  .refine((date) => moment(date, "YYYY-MM-DD", true).isValid(), { error: INVALID_DATE_MESSAGE });

export const dailyMealsQuery = z.object({ campus: cafeteriaCampus, date: calendarDate.optional() });
export type DailyMealsQuery = z.output<typeof dailyMealsQuery>;

const menuItem = z.object({
  name: z.string(),
  priceKrw: z.number().nullable(),
  kind: z.enum(["single", "set"]),
  dishes: z.array(z.string()),
  quantity: z.string().nullable(),
  options: z.array(z.object({ name: z.string(), extraKrw: z.number().nullable() })),
  tags: z.array(z.string()),
  days: z.array(z.enum(WEEKDAYS)),
});

const menuCell = z.object({
  name: z.string(),
  floor: z.string().nullable(),
  items: z.array(menuItem),
  rawText: z.string(),
  likes: z.number().nullable(),
  imageUrl: z.string().nullable(),
  isFixedMenu: z.boolean(),
  parseStatus: z.enum(PARSE_STATUSES),
  needsReview: z.boolean(),
});

export const menuDoc = z.object({
  _id: z.string(),
  cafeteriaId: z.string(),
  date: z.string(),
  meal: z.enum(MEAL_CODES),
  cells: z.array(menuCell),
}) satisfies z.ZodType<MenuDoc>;
