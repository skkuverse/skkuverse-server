// WHY: the client refetches every 15 s; the body is per user's request language and changes every poll, so no ETag (ADR 0022, D6).
export const JOURNEY_ROUTES_CACHE_CONTROL = "private, max-age=15";

// WHY: a planned route is reused per replica for at most this long, single-flight, so a burst of polls costs one plan (ADR 0022, D6).
export const PLAN_CACHE_TTL_MS = 5_000;

// WHY: the window each door is asked for; a later boarding of the PoC's routes is a next-service answer, not a plan.
export const PLAN_HORIZON_MS = 3 * 60 * 60_000;

// WHY: the owner's two later departures per ride leg (ADR 0022, D5).
export const MAX_LATER_CALLS = 2;

// WHY: the app's next two departures at a ride's board stop from now, shown as minutes away (app request, 2026-10-26).
export const MAX_UPCOMING_CALLS = 2;

// WHY: a service day runs from 03:00 KST, so from the last run to then reads 운행종료, as Korean transit apps show it
// (owner, 2026-10-25); every PoC line's night ends before it: 7800's last bus reaches 호매실 about 02:00 (ADR 0019).
export const SERVICE_DAY_START_MS = 3 * 60 * 60_000;

// WHY: a door or a place that fails stays so on every poll; one line a minute, as docs/reference/logging.md asks.
export const PLAN_LOG_INTERVAL_MS = 60_000;

// EVIDENCE: TOPIS predictions 0–3 min out miss by 60–80 s at p90 (ADR 0014), and walks are TMAP times rounded to whole
// minutes that leave out the walk inside a station (journey-routes revision 3, Sadang): under this, one such miss beyond
// the 60 s catch margin loses the connection.
export const TIGHT_TRANSFER_SEC = 120;

// EVIDENCE: the p90 error of this server's bus estimates at their longest measured horizon: TOPIS 1.5–2.5 min at 3–10
// min (ADR 0014), the HSSC engine 142 s three stops ahead (ADR 0018); longer rides are unmeasured, so this is a floor.
export const ESTIMATE_UNCERTAINTY_SEC = 150;

// WHY: product copy (.conventions.json productCopy), here because src/infra/i18n.ts sits at its line cap; `{place}` is
// the board place of the ride the rider may miss.
export const WARNING_MESSAGES = {
  tightTransfer: { ko: "{place}에서 갈아탈 시간이 빠듯해요", en: "Tight transfer at {place}", zh: "在{place}换乘时间紧张" },
  connectionAtRisk: { ko: "{place}에서 갈아탈 차를 놓칠 수 있어요", en: "You may miss the connection at {place}", zh: "在{place}可能赶不上换乘" },
} as const;

// WHY: product copy (.conventions.json productCopy), here because src/infra/i18n.ts sits at its line cap.
export const LEG_LABELS = {
  walk: { ko: "도보", en: "Walk", zh: "步行" },
  transfer: { ko: "환승", en: "Transfer", zh: "换乘" },
} as const;
