import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../../infra/types";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureBoard, DepartureQuery, DepartureSource } from "../../../shared/departure.types";
import type { Place } from "../../../shared/place.wire";
import { TOPIS_ROUTES } from "../../bus.constants";
import { BusLiveGroupService } from "../../live/group/bus-live-group.service";
import { BusRealtimeJongroService } from "../../realtime/jongro/bus-realtime-jongro.service";
import type { RegistryStation } from "../../registry/bus-registry.document";
import { BusRoutePathService } from "../../route-path/bus-route-path.service";
import type { RoutePath } from "../../route-path/bus-route-path.types";
import { BusStopIndexService } from "../../stop-index/bus-stop-index.service";
import { toStopPlace } from "../bus-departures.mapper";
import { toStopsBetween } from "../bus-departures.rules";
import { toStationCoords } from "./bus-departures-topis.mapper";
import { toLegStations, toRouteStationIndexes, toTopisBoard } from "./bus-departures-topis.rules";
import type { TopisLegStations } from "./bus-departures-topis.types";

type LegRead = { stationsVersion: string | null; lang: SupportedLang };

// SEE: docs/plans/transit-route-planner.md ("The doors"): the door for TOPIS routes, over the live route's calls.
@Injectable()
export class BusDeparturesTopisService implements DepartureSource {
  constructor(
    private readonly live: BusLiveGroupService,
    private readonly jongro: BusRealtimeJongroService,
    private readonly stopIndex: BusStopIndexService,
    private readonly routePaths: BusRoutePathService,
  ) {}

  // WHY: the live route's own answer, so a ride's calls are the ones /bus/live serves; the stored row adds the headway
  // and the stop's first and last run, which the live route does not serve.
  async listDepartures(query: DepartureQuery): Promise<DepartureBoard> {
    const route = TOPIS_ROUTES.find((candidate) => candidate.id === query.lineId);
    if (route === undefined) throw new DepartureUnavailableError(`${query.lineId} is no TOPIS route`);
    const [boardStop, alightStop, group, arrivals, serviceHours] = await Promise.all([
      this.stopIndex.findStop(query.boardStopId),
      query.alightStopId === null ? null : this.stopIndex.findStop(query.alightStopId),
      this.live.findLiveGroup(route.id, query.lang),
      this.jongro.findArrivalsEntry(route.code),
      this.jongro.listServiceHours(route.id),
    ]);
    const alightIndexes = query.alightStopId === null ? null : toRouteStationIndexes(alightStop, route.id, group.stationsVersion);
    const legStations = toLegStations(toRouteStationIndexes(boardStop, route.id, group.stationsVersion), alightIndexes);
    if (legStations === null) throw new DepartureUnavailableError(`${route.id} does not call at ${query.boardStopId} and then ${query.alightStopId ?? "anywhere"}`);
    if (arrivals === null) throw new DepartureUnavailableError(`no stored arrivals for ${route.id}`);
    const row = arrivals.value.find(({ sequence }) => Number(sequence) - 1 === legStations.boardIndex);
    const known = serviceHours.find(({ sequence }) => sequence - 1 === legStations.boardIndex);
    const board = toTopisBoard({ group, row: { ...(known && { firstTm: known.firstTm, lastTm: known.lastTm }), ...row }, legStations, query });
    const stops = await this.findLegStops(route.id, legStations, { stationsVersion: group.stationsVersion, lang: query.lang });
    return stops === null ? board : { ...board, stops };
  }

  // WHY: the registry the live route was placed by, so its station indexes are the leg's; a station TOPIS names `(미정차)`
  // is passed without stopping (ADR 0019, D4), and a stop with no coords leaves the leg's stops unlisted (ADR 0022, D4).
  private async findLegStops(routeId: string, { boardIndex, alightIndex }: TopisLegStations, { stationsVersion, lang }: LegRead): Promise<Place[] | null> {
    if (alightIndex === null) return null;
    const route = await this.jongro.registryRouteOf(routeId);
    if (route.stationsVersion !== stationsVersion) return null;
    const stations = toStopsBetween(route.registryStations, { boardIndex, alightIndex }, (station) => !route.passThroughOrds.has(station.sequence));
    // WHY: BusRoutePathService logs a line it cannot read; the stops are optional to the board, so they go unlisted.
    const routePath = await this.routePaths.findRoutePath(routeId).catch(() => null);
    const places = await Promise.all(stations.map((station) => this.toStationPlace(station, routePath, lang)));
    return places.every((place): place is Place => place !== null) ? places : null;
  }

  // WHY: a stop the catalog holds is served as /bus/stops serves it; a pole of an unlisted route no stop aliases has no
  // page, so it keeps its station id and TOPIS's name, at the coords of the stored route line (ADR 0019, D5).
  private async toStationPlace(station: RegistryStation, routePath: RoutePath | null, lang: SupportedLang): Promise<Place | null> {
    const stop = await this.stopIndex.findStop(station.topisId);
    const coords = stop?.coords ?? toStationCoords(routePath, station.topisId);
    if (coords === null) return null;
    if (stop === null) return toStopPlace({ id: station.topisId, name: station.stationName, coords }, false);
    const name = this.stopIndex.servedRecordOf(stop, lang)?.name ?? stop.poles[0]?.stationName ?? station.stationName;
    return toStopPlace({ id: stop.id, name, coords }, true);
  }
}
