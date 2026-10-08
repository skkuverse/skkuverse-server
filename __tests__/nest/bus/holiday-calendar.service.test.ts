/**
 * HolidayCalendarService delegates to holiday-calendar's
 * getNonOperatingDayLabel.
 *
 * date-holidays MUST be mocked (loading the real lib under ts-jest hangs). We
 * stub it to verify wiring: SKKU-first
 * lookup, public-type filtering, and null for ordinary days.
 */

jest.mock("date-holidays", () =>
  jest.fn().mockImplementation(() => ({
    isHoliday: (date: Date) => {
      const ds = date.toISOString().slice(0, 10);
      const table: Record<string, Array<{ name: string; type: string }>> = {
        "2026-01-01": [{ name: "신정", type: "public" }],
        "2026-10-09": [{ name: "한글날", type: "public" }],
        "2026-12-24": [{ name: "Christmas Eve", type: "observance" }],
      };
      return table[ds] ?? false;
    },
  })),
);

import { HolidayCalendarService } from "../../../src/bus/schedule/holiday-calendar.service";
import {
  lookupRestDay,
  parseRestDays,
} from "../../../src/bus/schedule/holiday-calendar";

let service: HolidayCalendarService;

beforeEach(() => {
  service = new HolidayCalendarService();
});

describe("HolidayCalendarService.getNonOperatingDayLabel", () => {
  it("returns the Korean name for a KR public holiday", () => {
    expect(service.getNonOperatingDayLabel("2026-01-01")).toBe("신정");
    expect(service.getNonOperatingDayLabel("2026-10-09")).toBe("한글날");
  });

  it("ignores non-public holiday types (e.g. observance)", () => {
    expect(service.getNonOperatingDayLabel("2026-12-24")).toBeNull();
  });

  it("returns null for an ordinary weekday", () => {
    expect(service.getNonOperatingDayLabel("2026-03-02")).toBeNull();
  });
});

describe("SKKU annual rest days (real skku-rest-days.json)", () => {
  it("closes 공자탄신일 on 09-28 every year", () => {
    expect(service.getNonOperatingDayLabel("2026-09-28")).toBe("공자탄신일");
    expect(service.getNonOperatingDayLabel("2027-09-28")).toBe("공자탄신일");
  });

  it("closes 건학기념일 on 09-25 every year", () => {
    expect(service.getNonOperatingDayLabel("2028-09-25")).toBe("건학기념일");
  });

  it("leaves the days around them alone", () => {
    expect(service.getNonOperatingDayLabel("2026-09-29")).toBeNull();
  });
});

describe("parseRestDays / lookupRestDay", () => {
  it("prefers an exact date over the annual rule", () => {
    const days = parseRestDays({
      "09-28": "공자탄신일",
      "2030-09-28": "공자탄신일 (특별)",
    });
    expect(lookupRestDay(days, "2030-09-28")).toBe("공자탄신일 (특별)");
    expect(lookupRestDay(days, "2031-09-28")).toBe("공자탄신일");
    expect(lookupRestDay(days, "2031-09-27")).toBeNull();
  });

  it("skips underscore documentation keys", () => {
    const days = parseRestDays({ _comment: "docs", _example: 1 });
    expect(days.exact.size + days.annual.size).toBe(0);
  });

  it("throws on a key that is neither YYYY-MM-DD nor MM-DD", () => {
    expect(() => parseRestDays({ "2026-9-28": "공자탄신일" })).toThrow(
      /neither YYYY-MM-DD nor MM-DD/,
    );
  });

  it("throws on a non-string or empty label", () => {
    expect(() => parseRestDays({ "09-28": true })).toThrow(/non-empty string/);
    expect(() => parseRestDays({ "09-28": "" })).toThrow(/non-empty string/);
  });
});
