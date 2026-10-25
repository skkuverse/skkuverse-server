import { Injectable } from "@nestjs/common";
import { DepartureUnavailableError } from "../../../shared/departure.error";
import type { DepartureBoard, DepartureQuery, DepartureSource } from "../../../shared/departure.types";
import { SubwayTimetablesUnavailableError } from "../subway-timetable.error";
import { SubwayTimetableService } from "../subway-timetable.service";
import type { PlatformSchedule } from "../subway-timetable.types";
import { toLegTrains, toNextServiceDayStart, toTimetableDepartureBoard } from "./subway-timetable-departures.rules";

type Ride = Pick<DepartureQuery, "lineId" | "boardStopId"> & { alightStopId: string };

// SEE: docs/plans/transit-route-planner.md ("Producers"): the subway's door, over the service day's stored timetables.
@Injectable()
export class SubwayTimetableDeparturesService implements DepartureSource {
  // WHY: by ride, for one service day: after the last train every poll needs the next day's first, whose tables a
  // read for another day would evict and read again (SubwayTimetableService holds one day type per line).
  private readonly nextServiceByRide = new Map<string, { serviceDate: string; nextServiceAt: Promise<Date | null> }>();

  constructor(private readonly timetable: SubwayTimetableService) {}

  async listDepartures(query: DepartureQuery): Promise<DepartureBoard> {
    const { alightStopId } = query;
    if (alightStopId === null) throw new DepartureUnavailableError(`subway line ${query.lineId} takes its direction from an alight platform`);
    const ride = { ...query, alightStopId };
    const [board, alight] = await this.findSchedules(ride, query.from);
    const today = toTimetableDepartureBoard(board, alight, query);
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
