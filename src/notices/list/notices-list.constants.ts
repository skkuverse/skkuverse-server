export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 50;

export const TYPE_MESSAGE = "type must be one of: action_required, event, informational";

export const CURSOR_MESSAGE = "cursor is malformed";

// WHY: an open-ended application window keeps its badge-less slot this long after it opens.
export const OPEN_ENDED_DAYS = 30;

// QUIRK(skkuverse-crawler): boards crawled before 2026-08-06 store `date` as "YYYY-MM-DD HH:mm"; the day is its first ten characters.
export const POSTING_DAY_LENGTH = 10;

// WHY: the order of umbrella ADR 0009 D2's day headers, newest group first.
export const LIST_DAYS = ["today", "yesterday", "thisWeek", "earlier"] as const;
