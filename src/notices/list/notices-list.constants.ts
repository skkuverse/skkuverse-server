export const DEFAULT_LIMIT = 20;

export const MAX_LIMIT = 50;

// EVIDENCE: a scan of several boards reads this many rows per row the page needs, since copies drop out. On _dev
// (2026-10-29) 56 to 65% of rows were shown copies, and all 53 pages of three picks filled from one scan.
export const CLUSTER_SCAN_FACTOR = 2;

export const TYPE_MESSAGE = "type must be one of: action_required, event, informational";

export const CURSOR_MESSAGE = "cursor is malformed";

// WHY: an open-ended application window keeps its badge-less slot this long after it opens.
export const OPEN_ENDED_DAYS = 30;

// QUIRK(skkuverse-crawler): boards crawled before 2026-08-06 store `date` as "YYYY-MM-DD HH:mm"; the day is its first ten characters.
export const POSTING_DAY_LENGTH = 10;

// WHY: the order of umbrella ADR 0009 D2's day headers, newest group first.
export const LIST_DAYS = ["today", "yesterday", "thisWeek", "earlier"] as const;
