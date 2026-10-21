import { ARS_ID_PATTERN, STOP_SERVICE_IDS_BY_GROUP_ID, TOPIS_STOP_ID_PREFIX } from "../bus.constants";
import { deepFreeze } from "../bus.rules";
import type { RegistryRoute } from "../registry/bus-registry.types";
import type { BusStopsSnapshot, ScheduleStop } from "../stops/bus-stops.types";
import type { IndexedStop, StopIndex, StopRoute } from "./bus-stop-index.types";

const HSSC_GROUP_ID = "hssc";

export function toTopisStopId(arsId: string): string {
  return `${TOPIS_STOP_ID_PREFIX}${arsId}`;
}

// WHY: the ARS number a TOPIS stop id names, or null for a local slug.
export function toPoleArsId(stopId: string): string | null {
  if (!stopId.startsWith(TOPIS_STOP_ID_PREFIX)) return null;
  const arsId = stopId.slice(TOPIS_STOP_ID_PREFIX.length);
  return ARS_ID_PATTERN.test(arsId) ? arsId : null;
}

// QUIRK(topis): a virtual stop carries the ARS number 0 or none, and no pole stands there.
function isPoleArsId(arsId: string): boolean {
  return ARS_ID_PATTERN.test(arsId) && Number(arsId) !== 0;
}

class StopIndexBuilder {
  readonly stopById = new Map<string, IndexedStop>();
  readonly stopIdByArsId = new Map<string, string>();
  private readonly localStopById: ReadonlyMap<string, ScheduleStop>;

  constructor(private readonly snapshot: BusStopsSnapshot) {
    this.localStopById = new Map(snapshot.catalog.stops.map((stop) => [stop.id, stop]));
  }

  addRoute(stopId: string, route: StopRoute): IndexedStop {
    const stop = this.stopById.get(stopId) ?? { id: stopId, localStop: this.localStopById.get(stopId) ?? null, poles: [], routes: [] };
    stop.routes.push(route);
    this.stopById.set(stopId, stop);
    return stop;
  }

  addHsscLine(): void {
    this.snapshot.hssc.forEach((station, stationIndex) => {
      if (station.stopId !== null) this.addRoute(station.stopId, { kind: "hssc", groupId: HSSC_GROUP_ID, stationIndex });
    });
  }

  addSequences(): void {
    const services = Object.entries(STOP_SERVICE_IDS_BY_GROUP_ID).flatMap(([groupId, serviceIds]) => serviceIds.map((serviceId) => ({ groupId, serviceId })));
    for (const { groupId, serviceId } of services) {
      for (const [routeType, sequence] of Object.entries(this.snapshot.catalog.sequences[serviceId] ?? {})) {
        sequence.forEach(({ stopId, action, timing }, sequenceIndex) => {
          if (stopId) this.addRoute(stopId, { kind: "shuttle", groupId, serviceId, routeType, sequenceIndex, action, timing });
        });
      }
    }
  }

  // WHY: a loop lists its terminal twice (02's 01881 departing and arriving); its first index is where riders board.
  addJongroRoute(route: RegistryRoute): void {
    const seenArsIds = new Set<string>();
    route.registryStations.forEach(({ arsId, topisId, stationName }, stationIndex) => {
      if (!isPoleArsId(arsId) || seenArsIds.has(arsId)) return;
      seenArsIds.add(arsId);
      const stopId = this.snapshot.stopIdByArsId.get(arsId) ?? toTopisStopId(arsId);
      this.stopIdByArsId.set(arsId, stopId);
      const towards = route.registryStations[stationIndex + 1]?.stationName ?? null;
      const stop = this.addRoute(stopId, { kind: "jongro", groupId: route.id, stationIndex, towards });
      if (!stop.poles.some((pole) => pole.arsId === arsId)) stop.poles.push({ arsId, topisId, stationName });
    });
  }
}

/** WHY: each stop's served routes, in the order /bus/config lists the HSSC line, the shuttle groups, then each Jongno route. */
export function toStopIndex(snapshot: BusStopsSnapshot, routes: readonly RegistryRoute[]): Omit<StopIndex, "registryFailure"> {
  const builder = new StopIndexBuilder(snapshot);
  builder.addHsscLine();
  builder.addSequences();
  for (const route of routes) builder.addJongroRoute(route);
  const unmatchedArsIds = [...snapshot.stopIdByArsId.keys()].filter((arsId) => !builder.stopIdByArsId.has(arsId));
  const index = deepFreeze({ stopById: builder.stopById, stopIdByArsId: builder.stopIdByArsId, unmatchedArsIds });
  return { snapshot, ...index };
}
