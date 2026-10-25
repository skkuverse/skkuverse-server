import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import config from "../infra/config";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import type { LogThrottle } from "../shared/log-throttle.types";
import { createLogThrottle } from "../shared/log-throttle.util";
import logger from "../infra/logger";
import { lookupKoreanPublicHoliday, toHolidayYear } from "../shared/korean-public-holiday.util";
import { ACADEMIC_READ_RETRY_MS, REST_DAYS_LOG_INTERVAL_MS, RULE_FALLBACK_LOG_INTERVAL_MS } from "./calendar.constants";
import { CalendarReadError, CalendarUnavailableError } from "./calendar.error";
import { toSchoolRestDayLabel } from "./calendar.mapper";
import { CalendarRepository } from "./calendar.repository";
import { lookupRestDay, toAcademicPeriod, toAcademicYear, toRuleSemesters } from "./calendar.rules";
import type { AcademicCalendarDoc } from "./calendar.document";
import type { AcademicPeriod, CalendarDay, CalendarSnapshot, RestDays, RestDaysRevision, SchoolRestDay } from "./calendar.types";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door for other features, which import only a
// .module or a .service.
@Injectable()
export class CalendarService {
  private readonly rulesFallbackThrottle: LogThrottle;
  private readonly academicFallbackThrottle: LogThrottle;
  private readonly academicReadFailedThrottle: LogThrottle;
  private readonly restDays: DatasetLoader<RestDaysRevision>;
  private academicReadHeldUntilMs = 0;

  constructor(
    private readonly repository: CalendarRepository,
    private readonly clock: Clock,
  ) {
    this.rulesFallbackThrottle = createLogThrottle(RULE_FALLBACK_LOG_INTERVAL_MS, () => this.clock.now().getTime());
    this.academicFallbackThrottle = createLogThrottle(RULE_FALLBACK_LOG_INTERVAL_MS, () => this.clock.now().getTime());
    this.academicReadFailedThrottle = createLogThrottle(ACADEMIC_READ_RETRY_MS, () => this.clock.now().getTime());
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
    const publicHolidayOn = await this.publicHolidaysOf(toHolidayYear(dateStr));
    return publicHolidayOn(dateStr);
  }

  // WHY: one read of the rest days and the crawled years answers every day a caller asks, so a cache built from its
  // days under `revisionKey` never mixes two revisions; the key changes with either but a public holiday.
  async current(): Promise<CalendarSnapshot> {
    const [{ revision, restDays }, academicYears] = await Promise.all([this.restDays.get(), this.listAcademicYears()]);
    const crawledVersions = [...academicYears].sort((a, b) => a.year - b.year).map((doc) => `${doc.year}@${doc.contentHash}`);
    return {
      revisionKey: [String(revision), ...crawledVersions].join("|"),
      dayOf: (dateStr) => this.dayOf(dateStr, restDays, academicYears),
    };
  }

  // WHY: a failed read with nothing cached is answered by the rule, never an error to a rider (ADR 0021, D2), and is
  // retried once ACADEMIC_READ_RETRY_MS passes rather than on every request.
  private async listAcademicYears(): Promise<readonly AcademicCalendarDoc[]> {
    if (this.clock.now().getTime() < this.academicReadHeldUntilMs) return [];
    try {
      return await this.repository.listAcademicYears();
    } catch (err) {
      if (config.cache.enabled) this.academicReadHeldUntilMs = this.clock.now().getTime() + ACADEMIC_READ_RETRY_MS;
      const ticket = this.academicReadFailedThrottle.take("read_failed");
      if (ticket) {
        logger.error(
          { event: "academic_calendar.read_failed", err, suppressed: ticket.suppressed },
          "Academic calendars unreadable with none cached, answering every year from the rule",
        );
      }
      return [];
    }
  }

  // WHY: the public holiday is asked first, so a date it cannot take throws its RangeError even on a rest day. The
  // dataset's rest day wins over the crawled one, so an operator can correct or add one.
  private async dayOf(dateStr: string, restDays: RestDays, academicYears: readonly AcademicCalendarDoc[]): Promise<CalendarDay> {
    const publicHoliday = await this.publicHolidayName(dateStr);
    const academicYear = toAcademicYear(dateStr);
    const crawled = academicYears.find((doc) => doc.year === academicYear);
    return {
      date: dateStr,
      publicHoliday,
      schoolRestDay: this.schoolRestDayOn(dateStr, restDays, crawled),
      academicPeriod: crawled ? toAcademicPeriod(dateStr, crawled.semesters, "crawled") : await this.ruleAcademicPeriod(dateStr, academicYear),
    };
  }

  private schoolRestDayOn(dateStr: string, restDays: RestDays, crawled: AcademicCalendarDoc | undefined): SchoolRestDay | null {
    const datasetLabel = lookupRestDay(restDays, dateStr);
    if (datasetLabel !== null) return { label: datasetLabel, source: "dataset" };
    const crawledRow = crawled?.restDays.find((row) => row.date === dateStr);
    return crawledRow ? { label: toSchoolRestDayLabel(crawledRow.title), source: "crawled" } : null;
  }

  private async ruleAcademicPeriod(dateStr: string, academicYear: number): Promise<AcademicPeriod> {
    const ticket = this.academicFallbackThrottle.take(String(academicYear));
    if (ticket) {
      logger.warn(
        { event: "academic_calendar.rule_fallback", academicYear, suppressed: ticket.suppressed },
        "No crawled academic calendar for the year, answering its semesters from the rule",
      );
    }
    const publicHolidayOn = await this.publicHolidaysOf(academicYear);
    return toAcademicPeriod(dateStr, toRuleSemesters(academicYear, (day) => publicHolidayOn(day) !== null), "rule");
  }

  // WHY: a year with no stored calendar warns only when a date of it is asked, so the rule never warns for a day it skips.
  private async publicHolidaysOf(year: number): Promise<(dateStr: string) => string | null> {
    const stored = (await this.repository.listPublicHolidayYears()).find((doc) => doc._id === year);
    if (stored) return (dateStr) => stored.holidays.find((holiday) => holiday.date === dateStr)?.name ?? null;
    return (dateStr) => {
      const ticket = this.rulesFallbackThrottle.take(String(year));
      if (ticket) {
        logger.warn(
          { event: "holidays.lookup.rules_fallback", year, suppressed: ticket.suppressed },
          "No stored calendar for the year, answering holidays from rules",
        );
      }
      return lookupKoreanPublicHoliday(dateStr);
    };
  }
}
