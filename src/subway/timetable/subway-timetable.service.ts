import { Injectable } from "@nestjs/common";
import { HolidaysService } from "../../holidays/holidays.service";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import type { NetworkPlatform } from "../subway.types";
import { TIMETABLES_LOG_INTERVAL_MS } from "./subway-timetable.constants";
import type { StoredTimetableManifest, TimetableManifestPart } from "./subway-timetable.document";
import { SubwayTimetablesReadError, SubwayTimetablesUnavailableError } from "./subway-timetable.error";
import { SubwayTimetableRepository } from "./subway-timetable.repository";
import {
  findSubwayPlatform,
  isInServiceWindow,
  listSubwayPlatforms,
  toDayType,
  toEvictedTimetableKeys,
  toLineRoutes,
  toPlatformTimetableKey,
  toScheduledTrains,
  toServiceDate,
  toUncoveredPlatformIdsByKey,
} from "./subway-timetable.rules";
import type { ManifestSnapshot, PlatformSchedule, PlatformSchedules, Timetable } from "./subway-timetable.types";

interface HeldTimetable {
  partId: string;
  table: Timetable;
  lastServiceDate: string;
}

interface ServiceDay {
  serviceDate: string;
  isPublicHoliday: boolean;
  now: Date;
}

// SEE: docs/explanation/subway-architecture.md ("Invariants"): the door the tracking flow and the pollers read
// timetables through; a table is read when a platform of its line is scheduled, once per stored content.
@Injectable()
export class SubwayTimetableService {
  private readonly manifest: DatasetLoader<ManifestSnapshot>;
  // WHY: a reload every TTL finds the same revision; its part ids are mapped, and its gaps logged, once.
  private snapshot: ManifestSnapshot | null = null;
  private readonly heldByKey = new Map<string, HeldTimetable>();
  private readonly readsByPartId = new Map<string, Promise<Timetable | null>>();
  // WHY: a part that failed is read again after a TTL, not on every request that needs it.
  private readonly failedUntilByPartId = new Map<string, number>();
  private readonly readFailedThrottle = createLogThrottle(TIMETABLES_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(
    private readonly holidays: HolidaysService,
    private readonly repository: SubwayTimetableRepository,
    private readonly clock: Clock,
  ) {
    this.manifest = createDatasetLoader({
      name: "subway.timetables",
      load: () => this.loadManifest(),
      clock,
      isReadError: (err): err is SubwayTimetablesReadError => err instanceof SubwayTimetablesReadError,
      toUnavailable: () => new SubwayTimetablesUnavailableError([]),
      readFailedEvent: "subway.timetables.read_failed",
      logIntervalMs: TIMETABLES_LOG_INTERVAL_MS,
    });
  }

  async listPlatformSchedules(now: Date): Promise<PlatformSchedules> {
    const day = await this.toServiceDay(now);
    const platforms = listSubwayPlatforms();
    const tables = await this.findTables(platforms.map((platform) => this.keyOf(platform, day)), day);
    const schedules = platforms.flatMap((platform) => {
      const table = tables.get(this.keyOf(platform, day));
      return table ? [this.toPlatformSchedule(platform, day, table)] : [];
    });
    const missingKeys = [...tables].filter(([, table]) => table === null).map(([key]) => key);
    return { schedules, unavailable: missingKeys.length > 0 ? new SubwayTimetablesUnavailableError(missingKeys) : null };
  }

  async findPlatformSchedule(platformId: string, now: Date): Promise<PlatformSchedule | null> {
    const platform = findSubwayPlatform(platformId);
    if (!platform) return null;
    const day = await this.toServiceDay(now);
    const key = this.keyOf(platform, day);
    const table = (await this.findTables([key], day)).get(key);
    if (!table) throw new SubwayTimetablesUnavailableError([key]);
    return this.toPlatformSchedule(platform, day, table);
  }

  async isInServiceWindow(now: Date): Promise<boolean> {
    const serviceDate = toServiceDate(now);
    const isPublicHoliday = await this.isPublicHoliday(serviceDate);
    const dayTypeOf = (platform: NetworkPlatform) => toDayType(platform.timetable.source, serviceDate, isPublicHoliday);
    return listSubwayPlatforms().some((platform) => isInServiceWindow(dayTypeOf(platform), serviceDate, now));
  }

  private async toServiceDay(now: Date): Promise<ServiceDay> {
    const serviceDate = toServiceDate(now);
    return { serviceDate, isPublicHoliday: await this.isPublicHoliday(serviceDate), now };
  }

  private keyOf(platform: NetworkPlatform, { serviceDate, isPublicHoliday }: ServiceDay): string {
    return toPlatformTimetableKey(platform, toDayType(platform.timetable.source, serviceDate, isPublicHoliday));
  }

  private toPlatformSchedule(platform: NetworkPlatform, { serviceDate, isPublicHoliday }: ServiceDay, table: Timetable): PlatformSchedule {
    const dayType = toDayType(platform.timetable.source, serviceDate, isPublicHoliday);
    return { platform, serviceDate, dayType, lineRoutes: toLineRoutes(table), trains: toScheduledTrains(table, serviceDate) };
  }

  // WHY: eviction runs per call, so a process holds at most one day type per line (move-reference-datasets D7).
  private async findTables(keys: readonly string[], day: ServiceDay): Promise<Map<string, Timetable | null>> {
    const snapshot = await this.currentManifest();
    const neededKeys = new Set(listSubwayPlatforms().map((platform) => this.keyOf(platform, day)));
    for (const key of toEvictedTimetableKeys(this.heldByKey, day.serviceDate, neededKeys)) this.heldByKey.delete(key);
    const uniqueKeys = [...new Set(keys)];
    const tables = await Promise.all(uniqueKeys.map((key) => this.findTable(key, snapshot, day)));
    return new Map(uniqueKeys.map((key, i) => [key, tables[i] ?? null]));
  }

  // WHY: a held table keeps serving while its replacement cannot be read, up to a day after the manifest first named
  // that replacement (move-reference-datasets D7); a key the manifest does not name has no table.
  private async findTable(key: string, snapshot: ManifestSnapshot | null, { serviceDate, now }: ServiceDay): Promise<Timetable | null> {
    const held = this.heldByKey.get(key);
    const partId = snapshot?.partIdByKey.get(key);
    if (snapshot === null || partId === undefined) return null;
    if (held?.partId === partId) return this.use(held, serviceDate);
    const table = await this.readPart({ key, partId }, snapshot.revision);
    if (table !== null) {
      this.heldByKey.set(key, { partId, table, lastServiceDate: serviceDate });
      return table;
    }
    const firstNamedAt = snapshot.firstNamedAtByPartId.get(partId) ?? now.getTime();
    return now.getTime() < firstNamedAt + DATASET_STALE_WINDOW_MS ? this.useHeld(held, serviceDate) : null;
  }

  private useHeld(held: HeldTimetable | undefined, serviceDate: string): Timetable | null {
    return held ? this.use(held, serviceDate) : null;
  }

  private use(held: HeldTimetable, serviceDate: string): Timetable {
    held.lastServiceDate = serviceDate;
    return held.table;
  }

  private readPart(part: TimetableManifestPart, revision: number): Promise<Timetable | null> {
    const nowMs = this.clock.now().getTime();
    if (nowMs < (this.failedUntilByPartId.get(part.partId) ?? 0)) return Promise.resolve(null);
    const inFlight = this.readsByPartId.get(part.partId);
    if (inFlight) return inFlight;
    const read = this.repository
      .findTable(part, revision)
      .catch((err: unknown) => this.toFailedRead(err, part, revision))
      .then((table) => {
        if (table === null) this.failedUntilByPartId.set(part.partId, nowMs + DATASET_CACHE_TTL_MS);
        return table;
      })
      .finally(() => this.readsByPartId.delete(part.partId));
    this.readsByPartId.set(part.partId, read);
    return read;
  }

  private toFailedRead(err: unknown, { key, partId }: TimetableManifestPart, revision: number): null {
    if (!(err instanceof SubwayTimetablesReadError)) throw err;
    const taken = this.readFailedThrottle.take(partId);
    if (taken) logger.error({ event: "subway.timetables.part_read_failed", revision, key, partId, err, ...taken }, "A subway timetable could not be read");
    return null;
  }

  private async currentManifest(): Promise<ManifestSnapshot | null> {
    try {
      return await this.manifest.get();
    } catch (err) {
      if (err instanceof SubwayTimetablesUnavailableError) return null;
      throw err;
    }
  }

  private async loadManifest(): Promise<ManifestSnapshot | null> {
    const stored = await this.repository.findManifest();
    if (stored === null) return null;
    if (stored.revision === this.snapshot?.revision) return this.snapshot;
    this.snapshot = this.toSnapshot(stored);
    for (const partId of this.failedUntilByPartId.keys()) if (!this.snapshot.firstNamedAtByPartId.has(partId)) this.failedUntilByPartId.delete(partId);
    this.logGaps(this.snapshot);
    return this.snapshot;
  }

  private toSnapshot({ revision, data }: StoredTimetableManifest): ManifestSnapshot {
    const namedAt = this.snapshot?.firstNamedAtByPartId ?? new Map<string, number>();
    const nowMs = this.clock.now().getTime();
    return {
      revision,
      partIdByKey: new Map(data.parts.map((part) => [part.key, part.partId])),
      firstNamedAtByPartId: new Map(data.parts.map((part) => [part.partId, namedAt.get(part.partId) ?? nowMs])),
    };
  }

  private logGaps({ revision, partIdByKey }: ManifestSnapshot): void {
    for (const [key, platformIds] of toUncoveredPlatformIdsByKey(new Set(partIdByKey.keys()), listSubwayPlatforms())) {
      logger.error({ event: "subway.timetables.table_missing", revision, key, platformIds }, "A subway platform the code serves has no stored timetable for a day type");
    }
  }

  private async isPublicHoliday(serviceDate: string): Promise<boolean> {
    return (await this.holidays.holidayName(serviceDate)) !== null;
  }
}
