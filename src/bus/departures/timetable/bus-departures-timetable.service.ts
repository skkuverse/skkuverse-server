import { Injectable } from "@nestjs/common";
import { t } from "../../../infra/i18n";
import type { SupportedLang } from "../../../infra/types";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureBoard, DepartureQuery, DepartureSource } from "../../../shared/departure.types";
import type { Place } from "../../../shared/place.wire";
import { BusEtaSmartService } from "../../eta/smart/bus-eta-smart.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import type { BusStopsSnapshot } from "../../stops/bus-stops.types";
import { toStopPlace } from "../bus-departures.mapper";
import { toKstDayStart, toLegStopIds, toLegStops, toTimetableBoard } from "./bus-departures-timetable.rules";
import type { LegStopsByRouteType } from "./bus-departures-timetable.types";

// SEE: docs/plans/transit-route-planner.md ("Producers"): the door for timetabled shuttles, read through the smart view's caches.
@Injectable()
export class BusDeparturesTimetableService implements DepartureSource {
  constructor(
    private readonly smart: BusEtaSmartService,
    private readonly stops: BusStopsService,
  ) {}

  async listDepartures(query: DepartureQuery): Promise<DepartureBoard> {
    const snapshot = await this.stops.current();
    const sequences = snapshot.catalog.sequences[query.lineId];
    const legStops = toLegStops(sequences, query.boardStopId, query.alightStopId);
    if (legStops.size === 0) throw new DepartureUnavailableError(`${query.lineId} does not call at ${query.boardStopId} and then ${query.alightStopId ?? "anywhere"}`);
    const board = await this.listRunBoard(query, legStops);
    const stops = this.toStopPlaces(snapshot, toLegStopIds(sequences, legStops), query.lang);
    return stops === null ? board : { ...board, stops };
  }

  // WHY: read from the start of the KST day, so a run's first and last flags see the runs that already left; the
  // following week is read only when nothing follows the window, as the stop page reads it.
  private async listRunBoard(query: DepartureQuery, legStops: LegStopsByRouteType): Promise<DepartureBoard> {
    const headsign = t(`busconfig.service.${query.lineId}`, query.lang);
    const from = toKstDayStart(query.from);
    const shown = await this.smart.listRuns(query.lineId, { from, weekCount: 1 });
    const board = toTimetableBoard(shown.runs, query, { legStops, headsign });
    if (board.nextServiceAt !== null || shown.status !== "active") return board;
    const withFollowing = await this.smart.listRuns(query.lineId, { from, weekCount: 2 });
    return toTimetableBoard(withFollowing.runs, query, { legStops, headsign });
  }

  // WHY: a stop with no coords cannot be drawn, so the leg lists none rather than some (ADR 0022, D4).
  private toStopPlaces({ catalog }: BusStopsSnapshot, stopIds: readonly string[] | null, lang: SupportedLang): Place[] | null {
    const places = (stopIds ?? []).map((id) => {
      const stop = catalog.stops.find((candidate) => candidate.id === id);
      return stop?.coords ? toStopPlace({ id, name: this.stops.servedStop(stop, lang).name, coords: stop.coords }, true) : null;
    });
    return stopIds !== null && places.every((place): place is Place => place !== null) ? places : null;
  }
}
