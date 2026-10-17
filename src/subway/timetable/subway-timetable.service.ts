import { Injectable } from "@nestjs/common";
import { HolidaysService } from "../../holidays/holidays.service";
import type { SubwayPlatform } from "../subway.types";
import { SUBWAY_TIMETABLES } from "./subway-timetable.config";
import {
  findSubwayPlatform,
  findTimetable,
  isInServiceWindow,
  listSubwayPlatforms,
  toDayType,
  toLineRoutes,
  toScheduledTrains,
  toServiceDate,
} from "./subway-timetable.rules";
import type { PlatformSchedule } from "./subway-timetable.types";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door the tracking flow and the pollers read
// timetables through, which siblings import only as a .module or a .service.
@Injectable()
export class SubwayTimetableService {
  constructor(private readonly holidays: HolidaysService) {}

  async listPlatformSchedules(now: Date): Promise<PlatformSchedule[]> {
    const serviceDate = toServiceDate(now);
    const isPublicHoliday = await this.isPublicHoliday(serviceDate);
    return listSubwayPlatforms().map((platform) => this.toPlatformSchedule(platform, serviceDate, isPublicHoliday));
  }

  async findPlatformSchedule(platformId: string, now: Date): Promise<PlatformSchedule | null> {
    const platform = findSubwayPlatform(platformId);
    if (!platform) return null;
    const serviceDate = toServiceDate(now);
    return this.toPlatformSchedule(platform, serviceDate, await this.isPublicHoliday(serviceDate));
  }

  async isInServiceWindow(now: Date): Promise<boolean> {
    const serviceDate = toServiceDate(now);
    const isPublicHoliday = await this.isPublicHoliday(serviceDate);
    const dayTypeOf = (platform: SubwayPlatform) => toDayType(platform.timetable.source, serviceDate, isPublicHoliday);
    return listSubwayPlatforms().some((platform) => isInServiceWindow(dayTypeOf(platform), serviceDate, now));
  }

  private toPlatformSchedule(platform: SubwayPlatform, serviceDate: string, isPublicHoliday: boolean): PlatformSchedule {
    const dayType = toDayType(platform.timetable.source, serviceDate, isPublicHoliday);
    const timetable = findTimetable(SUBWAY_TIMETABLES, platform, dayType);
    // WHY: unreachable: assertTimetablesCover stops the boot when a declared day type has no table.
    if (!timetable) throw new Error(`subway timetables: no ${dayType} table for ${platform.id}`);
    return { platform, serviceDate, dayType, lineRoutes: toLineRoutes(timetable), trains: toScheduledTrains(timetable, serviceDate) };
  }

  private async isPublicHoliday(serviceDate: string): Promise<boolean> {
    return (await this.holidays.holidayName(serviceDate)) !== null;
  }
}
