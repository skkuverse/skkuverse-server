import type { ServedStop } from "../bus.wire";
import type { LiveGroup } from "../live/bus-live.wire";
import type { FoundStop, ShuttleStopRoute, StopRoute } from "../stop-index/bus-stop-index.types";
import type { LiveEntry, StopBlock, TimetableEntry } from "./bus-stop-arrivals.types";

function toPoleBlock({ id, poles, coords }: FoundStop): StopBlock {
  const [pole] = poles;
  if (!pole) throw new Error(`bus-stops: stop ${id} is neither a local stop nor a pole, which the stop index never builds`);
  return { id, name: pole.stationName, ...(coords && { coords }), arsIds: poles.map((each) => each.arsId) };
}

/** WHY: a local stop is its config record, drawn at its pole when it has no coordinates; a TOPIS pole is its stored station. */
export function toStopBlock(stop: FoundStop, record: ServedStop | null): StopBlock {
  if (record === null) return toPoleBlock(stop);
  const arsIds = stop.localStop?.arsIds;
  return { ...record, ...(record.coords === undefined && stop.coords && { coords: stop.coords }), ...(arsIds && { arsIds: [...arsIds] }) };
}

// WHY: the live route lists only the stations its source states something for; any other is no data (ADR 0019, D8).
export function toLiveEntry({ groupId, stationIndex }: Pick<StopRoute, "groupId"> & { stationIndex: number }, group: LiveGroup, { label, towards }: Pick<LiveEntry, "label" | "towards">): LiveEntry {
  const station = group.stations.find((candidate) => candidate.stationIndex === stationIndex);
  const arrivals = station?.arrivals ?? [];
  const namedIds = new Set(arrivals.map(({ vehicleId }) => vehicleId));
  return {
    kind: "live",
    ...{ groupId, label, stationIndex, towards },
    ...{ stationsVersion: group.stationsVersion, updatedAt: group.updatedAt },
    operation: station?.operation ?? "noData",
    vehicles: group.vehicles.filter(({ id }) => namedIds.has(id)),
    arrivals,
  };
}

export function toTimetableEntry({ groupId, serviceId, routeType, action }: ShuttleStopRoute, label: string, { operation, arrivals }: Pick<TimetableEntry, "operation" | "arrivals">): TimetableEntry {
  return { kind: "timetable", groupId, label, serviceId, routeType, action, operation, vehicles: [], arrivals };
}
