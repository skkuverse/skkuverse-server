import type { MEAL_CODES, PARSE_STATUSES, WEEKDAYS } from "./meals-menus.constants";

export type MealCode = (typeof MEAL_CODES)[number];
export type ParseStatus = (typeof PARSE_STATUSES)[number];
export type Weekday = (typeof WEEKDAYS)[number];

export interface MenuOption {
  name: string;
  extraKrw: number | null;
}

export interface MenuItem {
  name: string;
  priceKrw: number | null;
  kind: "single" | "set";
  dishes: string[];
  quantity: string | null;
  options: MenuOption[];
  tags: string[];
  /** WHY: the weekdays the item is served on, empty for every day: a weekly board marks `[수]` items. */
  days: Weekday[];
}

export interface MenuCell {
  name: string;
  floor: string | null;
  items: MenuItem[];
  rawText: string;
  likes: number | null;
  imageUrl: string | null;
  isFixedMenu: boolean;
  parseStatus: ParseStatus;
  needsReview: boolean;
}

// CONTRACT(skkuverse-crawler): `MealDoc` of skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/models.py, one
// document per cafeteria, KST date and served meal in `meals`, `cells: []` included; the fields this server reads.
export interface MenuDoc {
  _id: string;
  cafeteriaId: string;
  date: string;
  meal: MealCode;
  cells: MenuCell[];
}
