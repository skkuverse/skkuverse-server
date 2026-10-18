import moment from "moment-timezone";
import { MEAL_CODES, WEEKDAYS } from "./meals-menus.constants";
import type { MealCode, MenuCell, MenuItem, Weekday } from "./meals-menus.document";

/** CONTRACT(skkuverse-crawler): `MealDoc.key` of skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/models.py. */
export function toMenuId(cafeteriaId: string, date: string, meal: MealCode): string {
  return `${cafeteriaId}:${date}:${meal}`;
}

export function toMenuIds(cafeteriaIds: readonly string[], date: string): string[] {
  return cafeteriaIds.flatMap((cafeteriaId) => MEAL_CODES.map((meal) => toMenuId(cafeteriaId, date, meal)));
}

export function toWeekday(date: string): Weekday {
  const weekday = WEEKDAYS[moment.utc(date, "YYYY-MM-DD", true).isoWeekday() - 1];
  if (!weekday) throw new Error(`not a calendar date: ${date}`);
  return weekday;
}

/** WHY: a `junk` cell is placeholder text (`test`) and a `closed` one says the corner is not operating. */
export function isServedCell(cell: MenuCell): boolean {
  return cell.parseStatus !== "junk" && cell.parseStatus !== "closed";
}

export function isServedOn(item: MenuItem, weekday: Weekday): boolean {
  return item.days.length === 0 || item.days.includes(weekday);
}

/** WHY: a corner left with no item is shown only when its raw text stands in for the items. */
export function isShownCorner(itemCount: number, needsReview: boolean): boolean {
  return itemCount > 0 || needsReview;
}

export function toMealRank(meal: MealCode): number {
  return MEAL_CODES.indexOf(meal);
}
