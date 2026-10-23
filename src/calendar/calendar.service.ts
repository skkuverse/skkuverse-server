import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { createLogThrottle, type LogThrottle } from "../infra/log-throttle";
import logger from "../infra/logger";
import { lookupKoreanPublicHoliday, toHolidayYear } from "../shared/korean-public-holiday.util";
import { CalendarRepository } from "./calendar.repository";

const RULES_FALLBACK_LOG_INTERVAL_MS = 60 * 60_000;

// SEE: docs/decisions/0010-server-architecture.md (D1): the door for other features, which import only a
// .module or a .service.
@Injectable()
export class CalendarService {
  private readonly rulesFallbackThrottle: LogThrottle;

  constructor(
    private readonly repository: CalendarRepository,
    private readonly clock: Clock,
  ) {
    this.rulesFallbackThrottle = createLogThrottle(RULES_FALLBACK_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  }

  async publicHolidayName(dateStr: string): Promise<string | null> {
    const year = toHolidayYear(dateStr);
    const stored = (await this.repository.listYears()).find((doc) => doc._id === year);
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
}
