import type { JongroBusType } from "../../cache/bus-cache.document";

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
