import { ARRIVING, LAST_STATION_SEQUENCE, NO_ARRIVAL, STALE_THRESHOLD_SECONDS } from "./bus-station.constants";
import type { HsscBusAtStation, HsscEtaStation } from "./bus-station.types";

const stationsAway = (station: HsscEtaStation, bus: HsscBusAtStation): string =>
  `${station.sequence - parseInt(bus.sequence)} 정거장 전`;

// WHY: the stale bus at the stop is skipped, and so is one waiting at the terminal behind it.
function nextBusEta(station: HsscEtaStation, approaching: readonly HsscBusAtStation[]): string {
  const candidate = approaching[1];
  if (!candidate) return NO_ARRIVAL;
  if (parseInt(candidate.sequence) !== LAST_STATION_SEQUENCE) return stationsAway(station, candidate);
  const fallback = approaching[2];
  return fallback ? stationsAway(station, fallback) : NO_ARRIVAL;
}

export function toHsscEta(station: HsscEtaStation, buses: readonly HsscBusAtStation[]): string {
  const approaching = buses
    .filter((bus) => parseInt(bus.sequence) <= station.sequence)
    .sort((a, b) => parseInt(b.sequence) - parseInt(a.sequence));
  const closest = approaching[0];
  if (!closest) return NO_ARRIVAL;
  if (station.sequence - parseInt(closest.sequence) > 0) return stationsAway(station, closest);
  if (closest.estimatedTime < STALE_THRESHOLD_SECONDS) return ARRIVING;
  return nextBusEta(station, approaching);
}

export function withHsscEtas(stations: readonly HsscEtaStation[], buses: readonly HsscBusAtStation[]): Array<HsscEtaStation & { eta: string }> {
  return stations.map((station) => ({ ...station, eta: toHsscEta(station, buses) }));
}
