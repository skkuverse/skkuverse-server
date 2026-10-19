/**
 * The timetable rules: the non-operating-day label (the SKKU list first, then
 * the public-holiday name it is given, null on an ordinary day, and a
 * RangeError on a date the holiday lookup cannot take), the rest-day lookup,
 * the week-start parameter, which pattern a date resolves to, and the
 * suspension window. Which dates are public holidays is HolidaysService's
 * (src/holidays/holidays.service.spec.ts).
 */

import fs from "fs";
import path from "path";
import moment from "moment-timezone";
import type { RestDays } from "../schedule-content/bus-schedule-content.types";
import type { BusScheduleDoc } from "./bus-schedule.document";
import { isWeekStartInRange, lookupRestDay, pickPattern, toNonOperatingDayLabel, toSuspendWindow } from "./bus-schedule.rules";

// Revision 1 of the skku-rest-days dataset (its fixture), built into RestDays as the dataset schema reads it.
const STORED_REST_DAYS: RestDays = {
  exact: new Map(),
  annual: new Map(
    Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, "../../../__tests__/nest/bus/fixtures/skku-rest-days.dataset.json"), "utf8")) as Record<string, string>).filter(
      ([key]) => key !== "_about",
    ),
  ),
};

describe("toNonOperatingDayLabel", () => {
  it.each([
    ["the calendar's name passes through", "2026-03-02", "대체공휴일(삼일절)", "대체공휴일(삼일절)"],
    ["an election day passes through", "2026-06-03", "전국동시지방선거", "전국동시지방선거"],
    ["a SKKU rest day beats a calendar name", "2026-09-28", "임시공휴일", "공자탄신일"],
    ["a SKKU rest day with no calendar name", "2026-09-25", null, "건학기념일"],
    ["null on an ordinary day", "2026-03-03", null, null],
  ])("%s: %s with %s → %s", (_label, date, publicHoliday, label) => {
    // Act & Assert
    expect(toNonOperatingDayLabel(STORED_REST_DAYS, date, publicHoliday)).toBe(label);
  });
});

describe("lookupRestDay", () => {
  it("prefers an exact date over the annual rule", () => {
    // Arrange
    const days: RestDays = { exact: new Map([["2030-09-28", "공자탄신일 (특별)"]]), annual: new Map([["09-28", "공자탄신일"]]) };

    // Act & Assert
    expect(lookupRestDay(days, "2030-09-28")).toBe("공자탄신일 (특별)");
    expect(lookupRestDay(days, "2031-09-28")).toBe("공자탄신일");
    expect(lookupRestDay(days, "2031-09-27")).toBeNull();
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


describe("isWeekStartInRange", () => {
  // WHY: 2026-03-09T16:30Z is already 2026-03-10 in KST, so a UTC reading would move every bound a day.
  const NOW = new Date("2026-03-09T16:30:00Z");

  it.each([
    ["2025-03-09", false],
    ["2025-03-10", true],
    ["2026-03-10", true],
    ["2027-03-10", true],
    ["2027-03-11", false],
    ["2026-02-31", false],
    ["9999-12-27", false],
  ])("%s → %s", (from, expected) => {
    // Act & Assert
    expect(isWeekStartInRange(from, NOW)).toBe(expected);
  });
});

// QUIRK(date-holidays): isHoliday never returns for an Invalid Date or a year-0 or year-1 day, and reads an
// impossible day (2026-02-29) as the next real one, so the label refuses those before asking it.
describe("toNonOperatingDayLabel on a date the holiday lookup cannot take", () => {
  it.each(["2026-13-01", "2026-02-31", "2026-02-29", "2026-04-31", "0000-01-03", "0001-01-01", "1899-12-31", "3000-01-01", "10000-01-01", "2026-1-01", "Invalid date"])(
    "throws on %s",
    (date) => {
      // Act & Assert
      expect(() => toNonOperatingDayLabel(STORED_REST_DAYS, date, null)).toThrow(`${date} is not a date from 1900 to 2999`);
    },
  );

  it.each([
    ["1900-01-01", null],
    ["2999-12-31", null],
    ["2028-02-29", null],
  ])("answers %s", (date, label) => {
    // Act & Assert
    expect(toNonOperatingDayLabel(STORED_REST_DAYS, date, null)).toBe(label);
  });

  it("refuses a year out of range even on a day the SKKU list names", () => {
    // Act & Assert
    expect(() => toNonOperatingDayLabel(STORED_REST_DAYS, "0001-09-28", null)).toThrow("0001-09-28 is not a date from 1900 to 2999");
  });
});
