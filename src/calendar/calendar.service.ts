import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import { createLogThrottle, type LogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { lookupKoreanPublicHoliday, toHolidayYear } from "../shared/korean-public-holiday.util";
import { REST_DAYS_LOG_INTERVAL_MS } from "./calendar.constants";
import { CalendarReadError, CalendarUnavailableError } from "./calendar.error";
import { CalendarRepository } from "./calendar.repository";
import { lookupRestDay } from "./calendar.rules";
import type { CalendarDay, RestDaysRevision } from "./calendar.types";

const RULES_FALLBACK_LOG_INTERVAL_MS = 60 * 60_000;

// SEE: docs/decisions/0010-server-architecture.md (D1): the door for other features, which import only a
// .module or a .service.
@Injectable()
export class CalendarService {
  private readonly rulesFallbackThrottle: LogThrottle;
  private readonly restDays: DatasetLoader<RestDaysRevision>;

  constructor(
    private readonly repository: CalendarRepository,
    private readonly clock: Clock,
  ) {
    this.rulesFallbackThrottle = createLogThrottle(RULES_FALLBACK_LOG_INTERVAL_MS, () => this.clock.now().getTime());
    this.restDays = createDatasetLoader({
      name: "calendar.rest_days",
      load: () => repository.findRestDays(),
      clock,
      isReadError: (err): err is CalendarReadError => err instanceof CalendarReadError,
      toUnavailable: () => new CalendarUnavailableError(),
      readFailedEvent: "calendar.rest_days.read_failed",
      logIntervalMs: REST_DAYS_LOG_INTERVAL_MS,
    });
  }

  async publicHolidayName(dateStr: string): Promise<string | null> {
    const year = toHolidayYear(dateStr);
    const stored = (await this.repository.listPublicHolidayYears()).find((doc) => doc._id === year);
    if (stored) return stored.holidays.find((holiday) => holiday.date === dateStr)?.name ?? null;
    const ticket = this.rulesFallbackThrottle.take(String(year));
    if (ticket) {
      logger.warn(
        { event: "holidays.lookup.rules_fallback", year, suppressed: ticket.suppressed },
        "No stored calendar for the year, answering holidays from rules",
      );
    }
    return lookupKoreanPublicHoliday(dateStr);
  }

  // WHY: the public holiday is asked first, so a date it cannot take throws its RangeError even on a rest day.
  async dayOf(dateStr: string): Promise<CalendarDay> {
    const publicHoliday = await this.publicHolidayName(dateStr);
    const { restDays } = await this.restDays.get();
    return { date: dateStr, publicHoliday, schoolRestDay: lookupRestDay(restDays, dateStr) };
  }

  // WHY: changes whenever an answer of dayOf may change but a public holiday, so a cache built from it can key on it.
  async revisionKey(): Promise<string> {
    const { revision } = await this.restDays.get();
    return String(revision);
  }
}
