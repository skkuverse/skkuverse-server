// EVIDENCE: line 4's page had no train from 05:16 KST on 2026-10-17 for 120 s (the window opens 05:00, its
// first train at a covered station is 05:34); longer than this, an empty line likelier means changed markup.
export const MAX_EMPTY_LINE_MS = 30 * 60_000;

// WHY: crawls further apart than this (the overnight closure, a daily ceiling) start a new empty spell.
export const MAX_EMPTY_CRAWL_GAP_MS = 10 * 60_000;

// QUIRK(seoul-trainmap): `line=0` answers the blocks of lines 1 to 8 in one page, about 156 KB (2026-10-17 21:16).
export const ALL_LINES_PAGE = "0";

// QUIRK(seoul-trainmap): a train div's class is `T<station code>_<flag>_<direction digit>_`, written `Y`/`N` and `1`/`2`,
// but line 2 numbers its branch trains' directions 3 to 6 and line 8 writes `1`/`2` and `0`/`1` (2026-10-17 21:16).
export const TRAIN_CLASS_BY_LINE: ReadonlyMap<string, RegExp> = new Map([
  ["2", /^T\d{4}_[YN]_([1-6])_/],
  ["8", /^T\d{4}_[12]_([01])_/],
]);

export const DEFAULT_TRAIN_CLASS = /^T\d{4}_[YN]_([12])_/;

export const MIN_BRANCH_DIRECTION_DIGIT = 3;
