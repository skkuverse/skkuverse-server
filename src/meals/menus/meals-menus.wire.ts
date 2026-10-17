import { z } from "zod";
import { CAFETERIA_CAMPUSES } from "../meals.constants";
import { MEAL_CODES } from "./meals-menus.constants";

const bilingualText = z.object({ ko: z.string(), en: z.string() });

const menuItem = z.object({
  name: z.string(),
  priceKrw: z.int().nullable(),
  kind: z.enum(["single", "set"]),
  /** WHY: a set's dishes, the first being `name`; empty for a single. */
  dishes: z.array(z.string()),
  quantity: z.string().nullable(),
  options: z.array(z.object({ name: z.string(), extraKrw: z.int() })),
  tags: z.array(z.string()),
});

const menuCorner = z.object({
  name: z.string(),
  floor: z.string().nullable(),
  isFixedMenu: z.boolean(),
  likes: z.int().nullable(),
  imageUrl: z.string().nullable(),
  items: z.array(menuItem),
  /** WHY: the parse was incomplete, so the app shows `rawText`, SKKU's own text, instead of `items`. */
  needsReview: z.boolean(),
  rawText: z.string(),
});

const meal = z.object({
  code: z.enum(MEAL_CODES),
  corners: z.array(menuCorner),
});

const cafeteriaMeals = z.object({
  /** CONTRACT(skkuverse-crawler): SKKU's conspaceCd, the `cafeteriaId` skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/models.py stores. */
  id: z.string(),
  name: bilingualText,
  building: z.object({ skkuId: z.int(), name: bilingualText }).nullable(),
  floor: bilingualText.nullable(),
  /** WHY: only the meals served that day, in MEAL_CODES order; empty for a cafeteria with no menu that day. */
  meals: z.array(meal),
});

export const dailyMeals = z.object({
  /** WHY: a KST calendar date, `YYYY-MM-DD`. */
  date: z.string(),
  campus: z.enum(CAFETERIA_CAMPUSES),
  cafeterias: z.array(cafeteriaMeals),
});

export type DailyMeals = z.input<typeof dailyMeals>;
