import { Injectable } from "@nestjs/common";
import type { SupportedLang } from "../../../infra/types";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureBoard, DepartureQuery, DepartureSource } from "../../../shared/departure.types";
import { SubwayArrivalsService } from "../../arrivals/subway-arrivals.service";
import { SubwayStationCoordsService } from "../../station-coords/subway-station-coords.service";
import { SubwayTopologyService } from "../../topology/subway-topology.service";
import { SubwayTimetablesUnavailableError } from "../subway-timetable.error";
import { SubwayTimetableService } from "../subway-timetable.service";
import type { PlatformSchedule } from "../subway-timetable.types";
import { toRideStopPlace, toRideStops } from "./subway-timetable-departures.mapper";
import { toLegTrains, toNextServiceDayStart, toTimetableDepartureBoard } from "./subway-timetable-departures.rules";
import type { RideStopsOf } from "./subway-timetable-departures.types";

type Ride = Pick<DepartureQuery, "lineId" | "boardStopId"> & { alightStopId: string };

// SEE: docs/plans/transit-route-planner.md ("Producers"): the subway's door, over the service day's stored timetables.
@Injectable()
export class SubwayTimetableDeparturesService implements DepartureSource {
  // WHY: by ride, for one service day: after the last train every poll needs the next day's first, whose tables a
  // read for another day would evict and read again (SubwayTimetableService holds one day type per line).
  private readonly nextServiceByRide = new Map<string, { serviceDate: string; nextServiceAt: Promise<Date | null> }>();

  constructor(
    private readonly timetable: SubwayTimetableService,
    private readonly arrivals: SubwayArrivalsService,
    private readonly topology: SubwayTopologyService,
    private readonly stationCoords: SubwayStationCoordsService,
  ) {}

  // WHY: a train the board platform's station board lists live boards by that board's call (ADR 0022 PR (h)).
  async listDepartures(query: DepartureQuery): Promise<DepartureBoard> {
    const { alightStopId } = query;
    if (alightStopId === null) throw new DepartureUnavailableError(`subway line ${query.lineId} takes its direction from an alight platform`);
    const ride = { ...query, alightStopId };
    const [[board, alight], liveCalls, stopsOf] = await Promise.all([this.findSchedules(ride, query.from), this.arrivals.listPlatformCalls(query.boardStopId), this.findStopsOf(ride, query.lang)]);
    const today = toTimetableDepartureBoard(board, alight, { ...query, liveCalls, stopsOf });
    if (today.nextServiceAt !== null) return today;
    if (toLegTrains(board, alight).length === 0) throw new DepartureUnavailableError(`no train of line ${ride.lineId} runs from ${ride.boardStopId} to ${alightStopId}`);
    return { ...today, nextServiceAt: await this.findNextServiceAt(ride, board.serviceDate) };
  }

  private async findSchedules({ lineId, boardStopId, alightStopId }: Ride, at: Date): Promise<[PlatformSchedule, PlatformSchedule]> {
    const [board, alight] = await Promise.all([this.findSchedule(boardStopId, at), this.findSchedule(alightStopId, at)]);
    if (board?.platform.line !== lineId || alight?.platform.line !== lineId) throw new DepartureUnavailableError(`${boardStopId} and ${alightStopId} are not both served platforms of line ${lineId}`);
    return [board, alight];
  }

  private async findSchedule(platformId: string, at: Date): Promise<PlatformSchedule | null> {
    try {
      return await this.timetable.findPlatformSchedule(platformId, at);
    } catch (err) {
      if (err instanceof SubwayTimetablesUnavailableError) throw new DepartureUnavailableError(err.message);
      throw err;
    }
  }

  // WHY: a ride lists no stops with no topology read; the board still serves (SubwayTopologyService logs why).
  private async findStopsOf({ boardStopId, alightStopId }: Ride, lang: SupportedLang): Promise<RideStopsOf | undefined> {
    const registry = (await this.topology.findCurrent())?.registry;
    if (registry === undefined) return undefined;
    const coordsById = new Map(await Promise.all(registry.stations.map(async ({ id }) => [id, await this.stationCoords.findCoords(id)] as const)));
    const catalog = { registry, coordsOf: (stationId: string) => coordsById.get(stationId) ?? null, lang };
    return (train) => toRideStops(train, [boardStopId, alightStopId], (platformId) => toRideStopPlace(platformId, catalog));
  }

  private findNextServiceAt(ride: Ride, serviceDate: string): Promise<Date | null> {
    const key = [ride.lineId, ride.boardStopId, ride.alightStopId].join("|");
    const held = this.nextServiceByRide.get(key);
    if (held?.serviceDate === serviceDate) return held.nextServiceAt;
    const dayStart = toNextServiceDayStart(serviceDate);
    const nextServiceAt = this.findSchedules(ride, dayStart).then(([board, alight]) => toTimetableDepartureBoard(board, alight, { ...ride, from: dayStart, until: dayStart }).nextServiceAt);
    this.nextServiceByRide.set(key, { serviceDate, nextServiceAt });
    nextServiceAt.catch(() => this.nextServiceByRide.delete(key));
    return nextServiceAt;
  }
}
