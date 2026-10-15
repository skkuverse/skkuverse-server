/**
 * The timetable rules: the non-operating-day label (the SKKU list first, then
 * public holidays only, null on an ordinary day), the rest-day lookup, the
 * week-start parameter, which pattern a date resolves to, and the suspension
 * window. date-holidays MUST be mocked (loading the real lib under ts-jest
 * hangs); the stub holds three dates.
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

import moment from "moment-timezone";
import { SKKU_REST_DAYS, loadRestDays as parseRestDays } from "./bus-schedule.config";
import type { BusScheduleDoc } from "./bus-schedule.document";
import { lookupRestDay, pickPattern, toNonOperatingDayLabel, toSuspendWindow } from "./bus-schedule.rules";

const service = { getNonOperatingDayLabel: (date: string) => toNonOperatingDayLabel(SKKU_REST_DAYS, date) };

describe("toNonOperatingDayLabel", () => {
  it("returns the Korean name for a KR public holiday", () => {
    // Act & Assert
    expect(service.getNonOperatingDayLabel("2026-01-01")).toBe("신정");
    expect(service.getNonOperatingDayLabel("2026-10-09")).toBe("한글날");
  });

  it("ignores non-public holiday types (e.g. observance)", () => {
    // Act & Assert
    expect(service.getNonOperatingDayLabel("2026-12-24")).toBeNull();
  });

  it("returns null for an ordinary weekday", () => {
    // Act & Assert
    expect(service.getNonOperatingDayLabel("2026-03-02")).toBeNull();
  });
});

describe("the SKKU annual rest days (real skku-rest-days.json)", () => {
  it("closes 공자탄신일 on 09-28 every year", () => {
    // Act & Assert
    expect(service.getNonOperatingDayLabel("2026-09-28")).toBe("공자탄신일");
    expect(service.getNonOperatingDayLabel("2027-09-28")).toBe("공자탄신일");
  });

  it("closes 건학기념일 on 09-25 every year", () => {
    // Act & Assert
    expect(service.getNonOperatingDayLabel("2028-09-25")).toBe("건학기념일");
  });

  it("leaves the days around them alone", () => {
    // Act & Assert
    expect(service.getNonOperatingDayLabel("2026-09-29")).toBeNull();
  });
});

describe("lookupRestDay over loadRestDays", () => {
  it("prefers an exact date over the annual rule", () => {
    // Act
    const days = parseRestDays({
      "09-28": "공자탄신일",
      "2030-09-28": "공자탄신일 (특별)",
    });

    // Assert
    expect(lookupRestDay(days, "2030-09-28")).toBe("공자탄신일 (특별)");
    expect(lookupRestDay(days, "2031-09-28")).toBe("공자탄신일");
    expect(lookupRestDay(days, "2031-09-27")).toBeNull();
  });

  it("skips underscore documentation keys", () => {
    // Act
    const days = parseRestDays({ _comment: "docs", _example: 1 });

    // Assert
    expect(days.exact.size + days.annual.size).toBe(0);
  });

  it("throws on a key that is neither YYYY-MM-DD nor MM-DD", () => {
    // Act & Assert
    expect(() => parseRestDays({ "2026-9-28": "공자탄신일" })).toThrow(
      /neither YYYY-MM-DD nor MM-DD/,
    );
  });

  it("throws on a non-string or empty label", () => {
    // Act & Assert
    expect(() => parseRestDays({ "09-28": true })).toThrow(/non-empty string/);
    expect(() => parseRestDays({ "09-28": "" })).toThrow(/non-empty string/);
  });
});

describe("pickPattern", () => {
  const pattern = (patternId: string, effectiveFrom?: string): BusScheduleDoc => ({
    serviceId: "campus-inja",
    patternId,
    days: [1],
    entries: [],
    ...(effectiveFrom ? { effectiveFrom } : {}),
  });

  it("returns the one pattern in effect, with no conflict", () => {
    // Act & Assert
    expect(pickPattern([pattern("weekday")], "2026-10-19", 1)).toEqual({ pattern: pattern("weekday"), conflicting: null });
  });

  it("serves the latest effectiveFrom, then the first patternId, and names the conflict", () => {
    // Arrange
    const patterns = [pattern("b"), pattern("a"), pattern("new", "2026-10-19")];

    // Act
    const picked = pickPattern(patterns, "2026-10-19", 1);

    // Assert
    expect(picked.pattern!.patternId).toBe("new");
    expect(picked.conflicting!.map((p) => p.patternId)).toEqual(["new", "a", "b"]);
  });
});

describe("toSuspendWindow", () => {
  const today = moment.tz("2026-07-15", "YYYY-MM-DD", "Asia/Seoul");

  it.each([
    [null, null],
    [{ from: "2026-06-21" }, null],
    [{ from: "2026-06-21", until: "2026-08-31" }, { invalid: false, resumeDate: "2026-09-01" }],
    [{ from: "2026-07-16", until: "2026-08-31" }, { invalid: false, resumeDate: null }],
    [{ from: "2026-08-31", until: "2026-06-21" }, { invalid: true }],
    [{ from: "bad-date", until: "2026-08-31" }, { invalid: true }],
  ])("%j → %j", (suspend, expected) => {
    // Act & Assert
    expect(toSuspendWindow(suspend, today)).toEqual(expected);
  });
});

