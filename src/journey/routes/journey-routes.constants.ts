// WHY: the client refetches every 15 s; the body is per user's request language and changes every poll, so no ETag (ADR 0022, D6).
export const JOURNEY_ROUTES_CACHE_CONTROL = "private, max-age=15";

// WHY: a planned route is reused per replica for at most this long, single-flight, so a burst of polls costs one plan (ADR 0022, D6).
export const PLAN_CACHE_TTL_MS = 5_000;

// WHY: the window each door is asked for; a later boarding of the PoC's routes is a next-service answer, not a plan.
export const PLAN_HORIZON_MS = 3 * 60 * 60_000;

// WHY: the owner's two later departures per ride leg (ADR 0022, D5).
export const MAX_LATER_CALLS = 2;

// WHY: a door or a place that fails stays so on every poll; one line a minute, as docs/reference/logging.md asks.
export const PLAN_LOG_INTERVAL_MS = 60_000;

// WHY: product copy (.conventions.json productCopy), here because src/infra/i18n.ts sits at its line cap.
export const LEG_LABELS = {
  walk: { ko: "도보", en: "Walk", zh: "步行" },
  transfer: { ko: "환승", en: "Transfer", zh: "换乘" },
} as const;
