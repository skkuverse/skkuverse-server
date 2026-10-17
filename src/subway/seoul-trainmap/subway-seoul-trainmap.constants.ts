// EVIDENCE: line 4's page had no train from 05:16 KST on 2026-10-17 for 120 s (the window opens 05:00, its
// first train at a covered station is 05:34); longer than this, an empty line likelier means changed markup.
export const MAX_EMPTY_LINE_MS = 30 * 60_000;

// WHY: crawls further apart than this (the overnight closure, a daily ceiling) start a new empty spell.
export const MAX_EMPTY_CRAWL_GAP_MS = 10 * 60_000;
