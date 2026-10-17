import { Injectable } from "@nestjs/common";
import { HolidaysService } from "../../holidays/holidays.service";
import { SUBWAY_STATIONS } from "../subway.constants";
import { findSubwayStation } from "../subway.rules";
import type { SubwayStation } from "../subway.types";
import { SUBWAY_TIMETABLES } from "./subway-timetable.config";
import { findTimetable, isInServiceWindow, toDayType, toLineRoutes, toScheduledTrains, toServiceDate } from "./subway-timetable.rules";
import type { StationSchedule } from "./subway-timetable.types";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door the tracking flow and the pollers read
// timetables through, which siblings import only as a .module or a .service.
@Injectable()
export class SubwayTimetableService {
  constructor(private readonly holidays: HolidaysService) {}

  async listStationSchedules(now: Date): Promise<StationSchedule[]> {
    const serviceDate = toServiceDate(now);
    const isPublicHoliday = await this.isPublicHoliday(serviceDate);
    return SUBWAY_STATIONS.map((station) => this.toStationSchedule(station, serviceDate, isPublicHoliday));
  }

  async findStationSchedule(platformId: string, now: Date): Promise<StationSchedule | null> {
    const station = findSubwayStation(platformId);
    if (!station) return null;
    const serviceDate = toServiceDate(now);
    return this.toStationSchedule(station, serviceDate, await this.isPublicHoliday(serviceDate));
  }

  async isInServiceWindow(now: Date): Promise<boolean> {
    const serviceDate = toServiceDate(now);
    const isPublicHoliday = await this.isPublicHoliday(serviceDate);
    const dayTypeOf = (station: SubwayStation) => toDayType(station.seoul.timetable.source, serviceDate, isPublicHoliday);
    return SUBWAY_STATIONS.some((station) => isInServiceWindow(dayTypeOf(station), serviceDate, now));
  }

  private toStationSchedule(station: SubwayStation, serviceDate: string, isPublicHoliday: boolean): StationSchedule {
    const dayType = toDayType(station.seoul.timetable.source, serviceDate, isPublicHoliday);
    const timetable = findTimetable(SUBWAY_TIMETABLES, station, dayType);
    // WHY: unreachable: assertTimetablesCover stops the boot when a declared day type has no table.
    if (!timetable) throw new Error(`subway timetables: no ${dayType} table for ${station.id}`);
    return { station, serviceDate, dayType, lineRoutes: toLineRoutes(timetable), trains: toScheduledTrains(timetable, serviceDate) };
  }

  private async isPublicHoliday(serviceDate: string): Promise<boolean> {
    return (await this.holidays.holidayName(serviceDate)) !== null;
  }
}
