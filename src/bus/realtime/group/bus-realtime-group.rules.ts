import type { CachedArrivalFields, JongroRouteStations, PlacedStationEta } from "./bus-realtime-group.types";

function toStationEta(route: JongroRouteStations, arrival: CachedArrivalFields): PlacedStationEta | null {
  if (!arrival.eta) return null;
  const ordIndex = parseInt(arrival.sequence, 10) - 1;
  if (route.topisIds[ordIndex] === arrival.stationId) return { stationIndex: ordIndex, eta: arrival.eta };
  const station = route.mapping[arrival.stationId];
  return station ? { stationIndex: station.sequence - 1, eta: arrival.eta } : null;
}

// QUIRK(topis): a row is placed by its ord, confirmed by the stop ID there, since a loop lists its terminal
// twice (02: ord 1 departing, ord 27 arriving); a reordered stop falls back to its ID. Names never match:
// TOPIS renames stops without notice, and loops pass same-named stops twice.
export function toStationEtas(route: JongroRouteStations, arrivals: readonly CachedArrivalFields[] | undefined): PlacedStationEta[] {
  return (arrivals ?? [])
    .map((arrival) => toStationEta(route, arrival))
    .filter((eta): eta is PlacedStationEta => eta !== null);
}
