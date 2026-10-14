import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";
import { DWELL_RESET_MINUTES } from "./bus-realtime-jongro.constants";
import type { JongroBusDwell, MismatchedStop, MissingStop, RegistryDrift, RenamedStop } from "./bus-realtime-jongro.types";

// QUIRK(topis): "0" is data and "4" no result (overnight); any other code is an upstream error.
export function isUsableHeaderCd(headerCd: string | undefined): boolean {
  return !headerCd || headerCd === "0" || headerCd === "4";
}

// WHY: TOPIS gives no arrival time, so a bus's time at its last passed stop counts from the first tick that
// saw a bus there; the dwell is per stop, not per bus.
export function toDwell(recordedAt: string | undefined, now: Date): JongroBusDwell {
  const minutesHeld = recordedAt ? (now.getTime() - new Date(recordedAt).getTime()) / 1000 / 60 : 0;
  if (!recordedAt || minutesHeld > DWELL_RESET_MINUTES) return { recordTime: now.toISOString(), estimatedTime: 0 };
  return { recordTime: recordedAt, estimatedTime: Math.round((now.getTime() - new Date(recordedAt).getTime()) / 1000) };
}

function toMismatchesAndRenames(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]) {
  const mismatched: MismatchedStop[] = [];
  const renamed: RenamedStop[] = [];
  for (const arrival of arrivals) {
    const idx = parseInt(arrival.sequence, 10) - 1;
    const expected = route.topisIds[idx];
    if (expected !== arrival.stationId) {
      mismatched.push({ staOrd: arrival.sequence, stId: arrival.stationId, stNm: arrival.stationName, expected: expected ?? null });
      continue;
    }
    const registryName = route.stations[idx]?.stationName;
    if (registryName !== undefined && registryName !== arrival.stationName) {
      renamed.push({ staOrd: arrival.sequence, stNm: arrival.stationName, registryName });
    }
  }
  return { mismatched, renamed };
}

function toMissingStops(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]): MissingStop[] {
  const seenOrds = new Set(arrivals.map((arrival) => parseInt(arrival.sequence, 10) - 1));
  return route.stations
    .map((station, idx) => ({ staOrd: String(idx + 1), topisId: route.topisIds[idx] ?? "", stationName: station.stationName }))
    .filter((_, idx) => !seenOrds.has(idx));
}

// QUIRK(topis): the arrival list names every stop of the route on every tick, so it shows when TOPIS adds,
// drops, reorders or renames a stop that jongro-routes.json still lists.
export function toRegistryDrift(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]): RegistryDrift | null {
  const { mismatched, renamed } = toMismatchesAndRenames(route, arrivals);
  const missing = toMissingStops(route, arrivals);
  if (mismatched.length === 0 && missing.length === 0 && renamed.length === 0) return null;
  return { mismatched, missing, renamed };
}
