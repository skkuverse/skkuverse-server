import { ARS_ID_PATTERN, STOP_SERVICE_IDS_BY_GROUP_ID, TOPIS_STOP_ID_PREFIX } from "../bus.constants";
import { deepFreeze, toServedArsId, toStationStopId, toStopAreaMembership } from "../bus.rules";
import type { RegistryRoute } from "../registry/bus-registry.types";
import type { BusStopsSnapshot, ScheduleStop } from "../stops/bus-stops.types";
import type { IndexedPole, IndexedStop, StopIndex, StopRoute } from "./bus-stop-index.types";

const HSSC_GROUP_ID = "hssc";

export function toPoleArsId(stopId: string): string | null {
  if (!stopId.startsWith(TOPIS_STOP_ID_PREFIX)) return null;
  const arsId = stopId.slice(TOPIS_STOP_ID_PREFIX.length);
  return ARS_ID_PATTERN.test(arsId) ? arsId : null;
}

export function hasPoleAliases(snapshot: BusStopsSnapshot, stopId: string): boolean {
  const stop = snapshot.catalog.stops.find((candidate) => candidate.id === stopId);
  return (stop?.arsIds?.length ?? 0) + (stop?.topisIds?.length ?? 0) > 0;
}

// WHY: a pole is its ARS number where it has one, since two routes may name one pole by two TOPIS station ids.
const toPoleKey = ({ arsId, topisId }: IndexedPole): string => arsId ?? `topis:${topisId}`;

class StopIndexBuilder {
  readonly stopById = new Map<string, IndexedStop>();
  readonly stopIdByArsId = new Map<string, string>();
  readonly matchedTopisIds = new Set<string>();
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
        sequence.forEach(({ stopId, action }, sequenceIndex) => {
          if (stopId) this.addRoute(stopId, { kind: "shuttle", groupId, serviceId, routeType, sequenceIndex, action });
        });
      }
    }
  }

  // WHY: a loop lists its terminal twice (02's 01881 departing and arriving); its first index is where riders board.
  addJongroRoute(route: RegistryRoute): void {
    const seenPoleKeys = new Set<string>();
    route.registryStations.forEach(({ arsId, topisId, stationName }, stationIndex) => {
      const stopId = toStationStopId({ arsId, topisId }, this.snapshot, route.isListed);
      const pole = { arsId: toServedArsId(arsId), topisId, stationName };
      if (stopId === null || seenPoleKeys.has(toPoleKey(pole))) return;
      seenPoleKeys.add(toPoleKey(pole));
      if (pole.arsId !== null) this.stopIdByArsId.set(pole.arsId, stopId);
      if (this.snapshot.stopIdByTopisId.has(topisId)) this.matchedTopisIds.add(topisId);
      const towards = route.registryStations[stationIndex + 1]?.stationName ?? null;
      const stop = this.addRoute(stopId, { kind: "jongro", groupId: route.id, stationIndex, towards, stationsVersion: route.stationsVersion });
      if (!stop.poles.some((each) => toPoleKey(each) === toPoleKey(pole))) stop.poles.push(pole);
    });
  }

  // WHY: a member the index cannot find (TOPIS dropped its pole) is left out and named, never failing the build (ADR 0022, D4).
  addStopAreas(): Array<{ stopAreaId: string; memberId: string }> {
    const indexedIdOf = (memberId: string): string | null => {
      const arsId = toPoleArsId(memberId);
      const stopId = arsId === null ? memberId : this.stopIdByArsId.get(arsId);
      return stopId !== undefined && this.stopById.has(stopId) ? stopId : null;
    };
    const { stopAreaIdByStopId, leftOutMembers } = toStopAreaMembership(this.snapshot.stopAreas, indexedIdOf);
    for (const stop of this.stopById.values()) {
      const stopAreaId = stopAreaIdByStopId.get(stop.id);
      if (stopAreaId !== undefined) stop.stopAreaId = stopAreaId;
    }
    return leftOutMembers.map(({ stopAreaId, memberId }) => ({ stopAreaId, memberId }));
  }
}

// WHY: each stop's served routes, in the order /bus/config lists the HSSC line, the shuttle groups, then each Jongno route;
// an ARS alias of a pole another stop's TOPIS alias claims serves nothing, so it is named with the unmatched ones.
export function toStopIndex(snapshot: BusStopsSnapshot, routes: readonly RegistryRoute[]): Omit<StopIndex, "registryFailure"> {
  const builder = new StopIndexBuilder(snapshot);
  builder.addHsscLine();
  builder.addSequences();
  for (const route of routes) builder.addJongroRoute(route);
  const unmatchedStopAreaMembers = builder.addStopAreas();
  const unmatchedArsIds = [...snapshot.stopIdByArsId].filter(([arsId, stopId]) => builder.stopIdByArsId.get(arsId) !== stopId).map(([arsId]) => arsId);
  const unmatchedTopisIds = [...snapshot.stopIdByTopisId.keys()].filter((topisId) => !builder.matchedTopisIds.has(topisId));
  const index = deepFreeze({ stopById: builder.stopById, stopIdByArsId: builder.stopIdByArsId, unmatchedArsIds, unmatchedTopisIds, unmatchedStopAreaMembers });
  return { snapshot, ...index };
}
