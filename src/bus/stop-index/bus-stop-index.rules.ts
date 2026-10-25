import { ARS_ID_PATTERN, LEGACY_POLE_ID_PREFIX, SLUG_LETTER_PATTERN, STOP_SERVICE_IDS_BY_GROUP_ID } from "../bus.constants";
import { deepFreeze, toServedArsId, toStationStopId, toStopAreaMembership } from "../bus.rules";
import type { StopAliases } from "../bus.types";
import type { RegistryRoute } from "../registry/bus-registry.types";
import type { BusStopsSnapshot, ScheduleStop } from "../stops/bus-stops.types";
import type { IndexedPole, IndexedStop, StopIndex, StopRoute } from "./bus-stop-index.types";

const HSSC_GROUP_ID = "hssc";

export function toPoleArsId(stopId: string): string | null {
  const arsId = stopId.startsWith(LEGACY_POLE_ID_PREFIX) ? stopId.slice(LEGACY_POLE_ID_PREFIX.length) : "";
  return ARS_ID_PATTERN.test(arsId) ? arsId : null;
}

/** WHY: a pole's station id or its `seoul-<arsId>` alias names the stop the pole is, a slug itself (ADR 0019, D5). */
export function toCanonicalStopId(aliases: StopAliases, stopId: string): string | undefined {
  const arsId = toPoleArsId(stopId);
  if (arsId !== null) return aliases.stopIdByArsId.get(arsId);
  return aliases.stopIdByTopisId.get(stopId) ?? (SLUG_LETTER_PATTERN.test(stopId) ? stopId : undefined);
}

export function hasPoleAliases(snapshot: BusStopsSnapshot, stopId: string): boolean {
  const stop = snapshot.catalog.stops.find((candidate) => candidate.id === stopId);
  return (stop?.arsIds?.length ?? 0) + (stop?.topisIds?.length ?? 0) > 0;
}

class StopIndexBuilder {
  readonly stopById = new Map<string, IndexedStop>();
  readonly stopIdByArsId = new Map<string, string>();
  readonly stopIdByTopisId = new Map<string, string>();
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
    const seenTopisIds = new Set<string>();
    route.registryStations.forEach(({ arsId, topisId, stationName }, stationIndex) => {
      const stopId = toStationStopId({ arsId, topisId }, this.snapshot, route.isListed);
      const pole: IndexedPole = { arsId: toServedArsId(arsId), topisId, stationName };
      if (stopId === null || seenTopisIds.has(topisId)) return;
      seenTopisIds.add(topisId);
      if (pole.arsId !== null) this.stopIdByArsId.set(pole.arsId, stopId);
      this.stopIdByTopisId.set(topisId, stopId);
      const towards = route.registryStations[stationIndex + 1]?.stationName ?? null;
      const stop = this.addRoute(stopId, { kind: "jongro", groupId: route.id, stationIndex, towards, stationsVersion: route.stationsVersion });
      if (!stop.poles.some((each) => each.topisId === topisId)) stop.poles.push(pole);
    });
  }

  // WHY: a member the index cannot find (TOPIS dropped its pole) is left out and named, never failing the build (ADR 0022, D4).
  addStopAreas(): Array<{ stopAreaId: string; memberId: string }> {
    const indexedIdOf = (memberId: string): string | null => {
      const stopId = toCanonicalStopId(this, memberId);
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
  const unmatchedTopisIds = [...snapshot.stopIdByTopisId.keys()].filter((topisId) => !builder.stopIdByTopisId.has(topisId));
  const index = deepFreeze({ stopById: builder.stopById, stopIdByArsId: builder.stopIdByArsId, stopIdByTopisId: builder.stopIdByTopisId, unmatchedArsIds, unmatchedTopisIds, unmatchedStopAreaMembers });
  return { snapshot, ...index };
}
