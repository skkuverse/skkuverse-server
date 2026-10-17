/**
 * SubwayTimetableService over the platforms and timetables a spec hands it, for a line the committed
 * registry and tables do not serve yet: it builds each platform's schedule with the real timetable rules
 * (service date, day type, routes, scheduled instants), as the real service does over the committed ones, with
 * no public holiday. Which committed table a platform reads, and the holiday calendar, are
 * subway-timetable.service.spec.ts's.
 */
import type { SubwayPlatform } from "../../../../src/subway/subway.types";
import {
  findTimetable,
  isInServiceWindow,
  toDayType,
  toLineRoutes,
  toScheduledTrains,
  toServiceDate,
} from "../../../../src/subway/timetable/subway-timetable.rules";
import type { SubwayTimetableService } from "../../../../src/subway/timetable/subway-timetable.service";
import type { PlatformSchedule, Timetable } from "../../../../src/subway/timetable/subway-timetable.types";
import type { PublicOf } from "../public-of";

export class FakeSubwayTimetableService implements PublicOf<SubwayTimetableService> {
  constructor(
    private readonly platforms: readonly SubwayPlatform[],
    private readonly timetables: readonly Timetable[],
  ) {}

  async listPlatformSchedules(now: Date): Promise<PlatformSchedule[]> {
    return this.platforms.map((platform) => this.toPlatformSchedule(platform, toServiceDate(now)));
  }

  async findPlatformSchedule(platformId: string, now: Date): Promise<PlatformSchedule | null> {
    const platform = this.platforms.find((candidate) => candidate.id === platformId);
    return platform ? this.toPlatformSchedule(platform, toServiceDate(now)) : null;
  }

  async isInServiceWindow(now: Date): Promise<boolean> {
    const serviceDate = toServiceDate(now);
    return this.platforms.some((platform) => isInServiceWindow(toDayType(platform.timetable.source, serviceDate, false), serviceDate, now));
  }

  private toPlatformSchedule(platform: SubwayPlatform, serviceDate: string): PlatformSchedule {
    const dayType = toDayType(platform.timetable.source, serviceDate, false);
    const timetable = findTimetable(this.timetables, platform, dayType);
    if (!timetable) throw new Error(`fake subway timetables: no ${dayType} table for ${platform.id}`);
    return { platform, serviceDate, dayType, lineRoutes: toLineRoutes(timetable), trains: toScheduledTrains(timetable, serviceDate) };
  }
}
