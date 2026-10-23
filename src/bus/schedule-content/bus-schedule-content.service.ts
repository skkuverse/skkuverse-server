import { Injectable } from "@nestjs/common";
import { CalendarService } from "../../calendar/calendar.service";
import type { CalendarSnapshot } from "../../calendar/calendar.types";
import { AppError } from "../../http/app.error";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import { serviceConfigOf } from "../bus.rules";
import { BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS } from "./bus-schedule-content.constants";
import { BusScheduleContentReadError, BusScheduleContentUnavailableError } from "./bus-schedule-content.error";
import { BusScheduleContentRepository } from "./bus-schedule-content.repository";
import type { ScheduleContent, ServiceNoticesRevision } from "./bus-schedule-content.types";

@Injectable()
export class BusScheduleContentService {
  // WHY: a reload every TTL re-finds the same stale ids; each is logged once per revision this process loads.
  private loggedNoticesRevision: number | null = null;
  private readonly serviceNotices: DatasetLoader<ServiceNoticesRevision>;

  constructor(
    private readonly repository: BusScheduleContentRepository,
    private readonly calendar: CalendarService,
    clock: Clock,
  ) {
    this.serviceNotices = createDatasetLoader({
      name: "bus.service_notices",
      load: () => this.loadServiceNotices(),
      clock,
      isReadError: (err): err is BusScheduleContentReadError => err instanceof BusScheduleContentReadError,
      toUnavailable: () => new BusScheduleContentUnavailableError(),
      readFailedEvent: "bus.service_notices.read_failed",
      logIntervalMs: BUS_SCHEDULE_CONTENT_LOG_INTERVAL_MS,
    });
  }

  async current(): Promise<ScheduleContent> {
    const [{ revision, services }, calendar] = await Promise.all([this.serviceNotices.get(), this.currentCalendar()]);
    const contentOf = (serviceId: string) => (Object.hasOwn(services, serviceId) ? services[serviceId] : undefined);
    return {
      revisionKey: `${revision}.${calendar.revisionKey}`,
      dayOf: (dateStr) => calendar.dayOf(dateStr),
      noticesOf: (serviceId) => contentOf(serviceId)?.notices ?? [],
      suspendOf: (serviceId) => contentOf(serviceId)?.suspend ?? null,
    };
  }

  // WHY: the calendar answers 503 while it holds no school rest days; riders keep the schedule's own 503 for it.
  private async currentCalendar(): Promise<CalendarSnapshot> {
    try {
      return await this.calendar.current();
    } catch (err) {
      if (err instanceof AppError && err.httpStatus === 503) throw new BusScheduleContentUnavailableError();
      throw err;
    }
  }

  // WHY: a service the code no longer defines (a revision older than the deploy) is ignored, so it serves nothing.
  private async loadServiceNotices(): Promise<ServiceNoticesRevision | null> {
    const stored = await this.repository.findServiceNotices();
    if (stored === null) return null;
    const unknownIds = Object.keys(stored.services).filter((serviceId) => serviceConfigOf(serviceId) === undefined);
    this.logUnknownServices(stored.revision, unknownIds);
    const services = Object.fromEntries(Object.entries(stored.services).filter(([serviceId]) => !unknownIds.includes(serviceId)));
    return { revision: stored.revision, services };
  }

  private logUnknownServices(revision: number, serviceIds: readonly string[]): void {
    if (revision === this.loggedNoticesRevision) return;
    this.loggedNoticesRevision = revision;
    for (const serviceId of serviceIds) {
      logger.warn({ event: "bus.service_notices.item_left_out", revision, serviceId }, "Service notices left out: the code defines no such service");
    }
  }
}
