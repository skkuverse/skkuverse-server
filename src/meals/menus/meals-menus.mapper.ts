import type { Campus } from "../../building/building.types";
import type { CafeteriaList } from "../catalog/meals-catalog.wire";
import type { MenuCell, MenuDoc, MenuItem, Weekday } from "./meals-menus.document";
import { isServedCell, isServedOn, isShownCorner, toMealRank, toWeekday } from "./meals-menus.rules";
import type { DailyMeals } from "./meals-menus.wire";

type CafeteriaMeals = DailyMeals["cafeterias"][number];
type Meal = CafeteriaMeals["meals"][number];
type MenuCorner = Meal["corners"][number];
type ListedCafeteria = CafeteriaList["cafeterias"][number];

function toServedItem({ name, priceKrw, kind, dishes, quantity, options, tags }: MenuItem): MenuCorner["items"][number] {
  return {
    name,
    priceKrw,
    kind,
    dishes,
    quantity,
    // WHY: the wire promises the app a price on every option; an unpriced one stays readable in `rawText`.
    options: options.flatMap((option) => (option.extraKrw === null ? [] : [{ name: option.name, extraKrw: option.extraKrw }])),
    tags,
  };
}

function toCorner(cell: MenuCell, weekday: Weekday): MenuCorner | null {
  if (!isServedCell(cell)) return null;
  const items = cell.items.filter((item) => isServedOn(item, weekday)).map(toServedItem);
  if (!isShownCorner(items.length, cell.needsReview)) return null;
  const { name, floor, isFixedMenu, likes, imageUrl, needsReview, rawText } = cell;
  return { name, floor, isFixedMenu, likes, imageUrl, items, needsReview, rawText };
}

function toMeals(menus: readonly MenuDoc[], weekday: Weekday): Meal[] {
  return [...menus]
    .sort((a, b) => toMealRank(a.meal) - toMealRank(b.meal))
    .map((menu) => ({ code: menu.meal, corners: menu.cells.flatMap((cell) => toCorner(cell, weekday) ?? []) }))
    .filter((served) => served.corners.length > 0);
}

function toCafeteriaMeals(cafeteria: ListedCafeteria, menus: readonly MenuDoc[], weekday: Weekday): CafeteriaMeals {
  const { id, name, building, floor } = cafeteria;
  return {
    id,
    name,
    building: building ? { skkuId: building.skkuId, name: building.name } : null,
    floor,
    meals: toMeals(menus, weekday),
  };
}

function toDailyMeals({ campus, date }: { campus: Campus; date: string }, cafeterias: CafeteriaList, menus: readonly MenuDoc[]): DailyMeals {
  const weekday = toWeekday(date);
  const menusByCafeteriaId = new Map<string, MenuDoc[]>();
  for (const menu of menus) {
    menusByCafeteriaId.set(menu.cafeteriaId, [...(menusByCafeteriaId.get(menu.cafeteriaId) ?? []), menu]);
  }
  return {
    date,
    campus,
    cafeterias: cafeterias.cafeterias.map((cafeteria) => toCafeteriaMeals(cafeteria, menusByCafeteriaId.get(cafeteria.id) ?? [], weekday)),
  };
}

export { toDailyMeals };
