import type { CachedArrivalFields, JongroRouteStops } from "./bus-realtime-group.types";
import type { StationEta } from "./bus-realtime-group.wire";

function toStationEta(route: JongroRouteStops, arrival: CachedArrivalFields): StationEta | null {
  if (!arrival.eta) return null;
  const ordIndex = parseInt(arrival.sequence, 10) - 1;
  if (route.topisIds[ordIndex] === arrival.stationId) return { stationIndex: ordIndex, eta: arrival.eta };
  const station = route.mapping[arrival.stationId];
  return station ? { stationIndex: station.sequence - 1, eta: arrival.eta } : null;
}

// QUIRK(topis): a row is placed by its ord, confirmed by the stop ID there, since a loop lists its terminal
// twice (02: ord 1 departing, ord 27 arriving); a reordered stop falls back to its ID. Names never match:
// TOPIS renames stops without notice, and loops pass same-named stops twice.
export function toStationEtas(route: JongroRouteStops, arrivals: readonly CachedArrivalFields[] | undefined): StationEta[] {
  return (arrivals ?? [])
    .map((arrival) => toStationEta(route, arrival))
    .filter((eta): eta is StationEta => eta !== null);
}
