import type { ServedStop } from "../bus.wire";
import type { GroupView } from "../realtime/group/bus-realtime-group.types";
import type { FoundStop, HsscStopRoute, JongroStopRoute, ShuttleStopRoute } from "../stop-index/bus-stop-index.types";
import type { Approaching, HsscEntry, JongroEntry, ShuttleEntry, StopBlock } from "./bus-stop-arrivals.types";

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

export function toJongroEntry({ groupId, stationIndex, towards }: JongroStopRoute, { stationEtas, stationsVersion }: GroupView, label: string): JongroEntry {
  if (stationsVersion === undefined) throw new Error(`bus: the realtime view of ${groupId} has no stations version`);
  const arrivals = stationEtas.filter((eta) => eta.stationIndex === stationIndex).flatMap((eta) => eta.arrivals);
  return { groupId, kind: "realtime", label, stationIndex, towards, stationsVersion, arrivals };
}

export function toHsscEntry({ groupId, stationIndex }: HsscStopRoute, label: string, approaching: Approaching[]): HsscEntry {
  return { groupId, kind: "realtime", label, stationIndex, approaching };
}

export function toShuttleEntry({ groupId, serviceId, routeType, action }: ShuttleStopRoute, label: string, { status, next }: Pick<ShuttleEntry, "status" | "next">): ShuttleEntry {
  return { groupId, kind: "schedule", label, serviceId, routeType, action, status, next };
}
