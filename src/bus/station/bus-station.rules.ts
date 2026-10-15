import { ARRIVING, LAST_STATION_SEQUENCE, NO_ARRIVAL, STALE_THRESHOLD_SECONDS } from "./bus-station.constants";
import type { HsscBusAtStop, HsscStation } from "./bus-station.types";

const stopsAway = (station: HsscStation, bus: HsscBusAtStop): string =>
  `${station.sequence - parseInt(bus.sequence)} 정거장 전`;

// WHY: the stale bus at the stop is skipped, and so is one waiting at the terminal behind it.
function nextBusEta(station: HsscStation, approaching: readonly HsscBusAtStop[]): string {
  const candidate = approaching[1];
  if (!candidate) return NO_ARRIVAL;
  if (parseInt(candidate.sequence) !== LAST_STATION_SEQUENCE) return stopsAway(station, candidate);
  const fallback = approaching[2];
  return fallback ? stopsAway(station, fallback) : NO_ARRIVAL;
}

export function toHsscEta(station: HsscStation, buses: readonly HsscBusAtStop[]): string {
  const approaching = buses
    .filter((bus) => parseInt(bus.sequence) <= station.sequence)
    .sort((a, b) => parseInt(b.sequence) - parseInt(a.sequence));
  const closest = approaching[0];
  if (!closest) return NO_ARRIVAL;
  if (station.sequence - parseInt(closest.sequence) > 0) return stopsAway(station, closest);
  if (closest.estimatedTime < STALE_THRESHOLD_SECONDS) return ARRIVING;
  return nextBusEta(station, approaching);
}

export function withHsscEtas(stations: readonly HsscStation[], buses: readonly HsscBusAtStop[]): HsscStation[] {
  return stations.map((station) => ({ ...station, eta: toHsscEta(station, buses) }));
}
