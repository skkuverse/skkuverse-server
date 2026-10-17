import type { LocalizedName } from "../subway.types";

// WHY: private: the labels follow Accept-Language, which a shared cache does not key on.
export const ARRIVALS_CACHE_CONTROL = "private, max-age=5";

// WHY: older than this, the tracker has stopped writing (both upstreams down, or no poller), so the route
// serves the timetable alone.
export const MAX_STATE_AGE_MS = 2 * 60_000;

// SEE: docs/explanation/subway-architecture.md ("Structure"): what adding a station touches.
export const NEIGHBOR_NAME_BY_STATION_ID: Readonly<Record<string, LocalizedName>> = {
  "KR-1-P152": { ko: "의왕", en: "Uiwang", zh: "义王" },
  "KR-1-P154": { ko: "화서", en: "Hwaseo", zh: "华西" },
  "S1-4-419": { ko: "한성대입구", en: "Hansung Univ.", zh: "汉城大入口" },
  "S1-4-421": { ko: "동대문", en: "Dongdaemun", zh: "东大门" },
};
