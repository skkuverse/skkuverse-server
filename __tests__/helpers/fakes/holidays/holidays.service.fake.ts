/**
 * HolidaysService with a scripted calendar, for a feature that reads public
 * holidays through it: `names` maps a KST date (YYYY-MM-DD) to its holiday
 * name, and any other date is no holiday. How the real service answers a date
 * (stored years, the rules fallback, the RangeError) is
 * holidays.service.spec.ts's.
 */
import type { HolidaysService } from "../../../../src/holidays/holidays.service";
import type { PublicOf } from "../public-of";

export class FakeHolidaysService implements PublicOf<HolidaysService> {
  names = new Map<string, string>();

  async holidayName(dateStr: string): Promise<string | null> {
    return this.names.get(dateStr) ?? null;
  }

  async sync(): Promise<void> {}
}
