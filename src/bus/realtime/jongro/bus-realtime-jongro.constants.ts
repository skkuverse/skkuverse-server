import type { JongroBusType } from "../../cache/bus-cache.document";

// EVIDENCE: TOPIS's dataTm advances about every 20 s (2026-10-17 capture). At 25 s the three routes make 10,368 calls a
// day to each of getArrInfoByRouteAllList and getBusPosByRtidList (12,368 with the probe's 2,000 cap) of 20,000,
// leaving room for the paused crawler's 6,480. SEE: docs/project-docs.md ("Daily Usage and Quota Check")
export const POLL_INTERVAL_MS = 25_000;

// WHY: a stop held longer than this is a new arrival, not the same dwell.
export const DWELL_RESET_MINUTES = 10;

// WHY: agreed with skkuverse-app: GPS jitter of an idling bus stays under this.
export const MAX_STATIONARY_MOVE_METERS = 10;

// QUIRK(topis): getBusPosByRtid's busType and getArrInfoByRouteAll's busType1/busType2 per vehicle (data.go.kr 15000314).
export const BUS_TYPE_BY_CODE: ReadonlyMap<string, JongroBusType> = new Map([
  ["0", "general"],
  ["1", "lowFloor"],
  ["2", "articulated"],
]);
