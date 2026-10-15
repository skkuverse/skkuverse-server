import type { BusCacheKey, JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";
import { DWELL_RESET_MINUTES } from "./bus-realtime-jongro.constants";
import type { JongroBusDwell, MismatchedStation, MissingStation, RegistryDrift, RenamedStation } from "./bus-realtime-jongro.types";

export function toArrivalsKey(code: string): BusCacheKey & `jongro_stations_${string}` {
  return `jongro_stations_${code}`;
}

export function toPositionsKey(code: string): BusCacheKey & `jongro_locations_${string}` {
  return `jongro_locations_${code}`;
}

// QUIRK(topis): "0" is data and "4" no result (overnight); any other code is an upstream error.
export function isUsableHeaderCd(headerCd: string | undefined): boolean {
  return !headerCd || headerCd === "0" || headerCd === "4";
}

// WHY: TOPIS gives no arrival time, so a bus's time at its last passed station counts from the first tick that
// saw a bus there; the dwell is per station, not per bus.
export function toDwell(firstSeenAt: string | undefined, now: Date): JongroBusDwell {
  const minutesHeld = firstSeenAt ? (now.getTime() - new Date(firstSeenAt).getTime()) / 1000 / 60 : 0;
  if (!firstSeenAt || minutesHeld > DWELL_RESET_MINUTES) return { firstSeenAt: now.toISOString(), dwellSeconds: 0 };
  return { firstSeenAt, dwellSeconds: Math.round((now.getTime() - new Date(firstSeenAt).getTime()) / 1000) };
}

function toMismatchesAndRenames(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]) {
  const mismatched: MismatchedStation[] = [];
  const renamed: RenamedStation[] = [];
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

function toMissingStations(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]): MissingStation[] {
  const seenOrds = new Set(arrivals.map((arrival) => parseInt(arrival.sequence, 10) - 1));
  return route.stations
    .map((station, idx) => ({ staOrd: String(idx + 1), topisId: route.topisIds[idx] ?? "", stationName: station.stationName }))
    .filter((_, idx) => !seenOrds.has(idx));
}

// QUIRK(topis): the arrival list names every stop of the route on every tick, so it shows when TOPIS adds,
// drops, reorders or renames a stop that jongro-routes.json still lists.
export function toRegistryDrift(route: JongroRoute, arrivals: readonly JongroArrivalDoc[]): RegistryDrift | null {
  const { mismatched, renamed } = toMismatchesAndRenames(route, arrivals);
  const missing = toMissingStations(route, arrivals);
  if (mismatched.length === 0 && missing.length === 0 && renamed.length === 0) return null;
  return { mismatched, missing, renamed };
}
