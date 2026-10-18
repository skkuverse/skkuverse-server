/** CONTRACT(skkuverse-crawler): the meal codes of skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/models.py, in serving order. */
export const MEAL_CODES = ["B", "L", "D", "S", "R"] as const;

export const PARSE_STATUSES = ["ok", "partial", "raw", "closed", "junk"] as const;

/** CONTRACT(skkuverse-crawler): `WEEKDAYS` of skkuverse-crawler/py/src/skkuverse_crawler/modules/meals/normalize.py, Monday first. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** WHY: public, since the body names both languages; the crawler rewrites a week's menus four times a day. */
export const DAILY_MEALS_CACHE_CONTROL = "public, max-age=300, s-maxage=600";

// WHY: a minute, so a crawler rewrite shows well inside the edge's ten; one read per date per minute per replica.
export const MENU_CACHE_TTL_MS = 60_000;

/** WHY: bounds the per-replica cache: both campuses over this week and next, plus a few dates looked back on. */
export const MAX_CACHED_MENU_DATES = 64;
