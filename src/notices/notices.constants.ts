export const SUMMARY_TYPES = ["action_required", "event", "informational"] as const;

// EVIDENCE: the app's all-tabs search scope unions every followed tab: ~8 ids by default, 20 with every picker full.
// `$in` scans one index branch per id, so rerun scripts/explain-notices-search.js before raising it.
export const MAX_SOURCE_IDS = 20;

export const MAX_QUERY_CODEPOINTS = 100;

export const NOTICES_TIMEZONE = "Asia/Seoul";
