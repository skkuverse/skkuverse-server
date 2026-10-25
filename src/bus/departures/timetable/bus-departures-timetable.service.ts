import { Injectable } from "@nestjs/common";
import { t } from "../../../infra/i18n";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureBoard, DepartureQuery, DepartureSource } from "../../../shared/departure.types";
import { BusEtaSmartService } from "../../eta/smart/bus-eta-smart.service";
import { BusStopsService } from "../../stops/bus-stops.service";
import { toKstDayStart, toLegStops, toTimetableBoard } from "./bus-departures-timetable.rules";

// SEE: docs/plans/transit-route-planner.md ("Producers"): the door for timetabled shuttles, read through the smart view's caches.
@Injectable()
export class BusDeparturesTimetableService implements DepartureSource {
  constructor(
    private readonly smart: BusEtaSmartService,
    private readonly stops: BusStopsService,
  ) {}

  // WHY: read from the start of the KST day, so a run's first and last flags see the runs that already left; the
  // following week is read only when nothing follows the window, as the stop page reads it.
  async listDepartures(query: DepartureQuery): Promise<DepartureBoard> {
    const snapshot = await this.stops.current();
    const legStops = toLegStops(snapshot.catalog.sequences[query.lineId], query.boardStopId, query.alightStopId);
    if (legStops.size === 0) throw new DepartureUnavailableError(`${query.lineId} does not call at ${query.boardStopId} and then ${query.alightStopId ?? "anywhere"}`);
    const headsign = t(`busconfig.service.${query.lineId}`, query.lang);
    const from = toKstDayStart(query.from);
    const shown = await this.smart.listRuns(query.lineId, { from, weekCount: 1 });
    const board = toTimetableBoard(shown.runs, query, { legStops, headsign });
    if (board.nextServiceAt !== null || shown.status !== "active") return board;
    const withFollowing = await this.smart.listRuns(query.lineId, { from, weekCount: 2 });
    return toTimetableBoard(withFollowing.runs, query, { legStops, headsign });
  }
}
