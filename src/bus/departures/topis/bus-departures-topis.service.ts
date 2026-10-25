import { Injectable } from "@nestjs/common";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureBoard, DepartureQuery, DepartureSource } from "../../../shared/departure.types";
import { TOPIS_ROUTES } from "../../bus.constants";
import { BusLiveGroupService } from "../../live/group/bus-live-group.service";
import { BusRealtimeJongroService } from "../../realtime/jongro/bus-realtime-jongro.service";
import { BusStopIndexService } from "../../stop-index/bus-stop-index.service";
import { toLegStations, toRouteStationIndexes, toTopisBoard } from "./bus-departures-topis.rules";

// SEE: docs/plans/transit-route-planner.md ("The doors"): the door for TOPIS routes, over the live route's calls.
@Injectable()
export class BusDeparturesTopisService implements DepartureSource {
  constructor(
    private readonly live: BusLiveGroupService,
    private readonly jongro: BusRealtimeJongroService,
    private readonly stopIndex: BusStopIndexService,
  ) {}

  // WHY: the live route's own answer, so a ride's calls are the ones /bus/live serves; the stored row adds the headway
  // and the stop's first and last run, which the live route does not serve.
  async listDepartures(query: DepartureQuery): Promise<DepartureBoard> {
    const route = TOPIS_ROUTES.find((candidate) => candidate.id === query.lineId);
    if (route === undefined) throw new DepartureUnavailableError(`${query.lineId} is no TOPIS route`);
    const [boardStop, alightStop, group, arrivals] = await Promise.all([
      this.stopIndex.findStop(query.boardStopId),
      query.alightStopId === null ? null : this.stopIndex.findStop(query.alightStopId),
      this.live.findLiveGroup(route.id, query.lang),
      this.jongro.findArrivalsEntry(route.code),
    ]);
    const alightIndexes = query.alightStopId === null ? null : toRouteStationIndexes(alightStop, route.id, group.stationsVersion);
    const legStations = toLegStations(toRouteStationIndexes(boardStop, route.id, group.stationsVersion), alightIndexes);
    if (legStations === null) throw new DepartureUnavailableError(`${route.id} does not call at ${query.boardStopId} and then ${query.alightStopId ?? "anywhere"}`);
    if (arrivals === null) throw new DepartureUnavailableError(`no stored arrivals for ${route.id}`);
    const row = arrivals.value.find(({ sequence }) => Number(sequence) - 1 === legStations.boardIndex);
    return toTopisBoard({ group, row, legStations, query });
  }
}
