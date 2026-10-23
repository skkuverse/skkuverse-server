/**
 * The timetable rules: the non-operating-day label (the school rest day
 * first, then the public holiday, null on an ordinary day), the week-start
 * parameter, which pattern a date resolves to, the suspension window, and a
 * day the smart view shows inside it. Which dates are public holidays and
 * school rest days, and the RangeError on a date the holiday lookup cannot
 * take, are CalendarService's (src/calendar/calendar.service.spec.ts).
 */

import moment from "moment-timezone";
import type { BusScheduleDoc } from "./bus-schedule.document";
import { isWeekStartInRange, pickPattern, toNonOperatingDayLabel, toSuspendedDay, toSuspendWindow } from "./bus-schedule.rules";
import type { ScheduleDay } from "./bus-schedule.wire";

describe("toNonOperatingDayLabel", () => {
  it.each([
    ["the calendar's name passes through", "2026-03-02", "대체공휴일(삼일절)", null, "대체공휴일(삼일절)"],
    ["an election day passes through", "2026-06-03", "전국동시지방선거", null, "전국동시지방선거"],
    ["a SKKU rest day beats a calendar name", "2026-09-28", "임시공휴일", "공자탄신일", "공자탄신일"],
    ["a SKKU rest day with no calendar name", "2026-09-25", null, "건학기념일", "건학기념일"],
    ["null on an ordinary day", "2026-03-03", null, null, null],
  ])("%s: %s with %s and %s → %s", (_label, date, publicHoliday, schoolRestDay, label) => {
    // Act & Assert
    expect(toNonOperatingDayLabel({ date, publicHoliday, schoolRestDay })).toBe(label);
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


describe("toSuspendedDay", () => {
  const SUSPEND = { from: "2026-12-15", until: "2026-12-16" };
  const scheduled = (date: string, dayOfWeek: number): ScheduleDay => ({
    date,
    dayOfWeek,
    display: "schedule",
    label: "기말고사",
    notices: [{ style: "info", text: "서비스 공지", source: "service" }],
    schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }],
  });
  const noService = (date: string, dayOfWeek: number): ScheduleDay => ({ date, dayOfWeek, display: "noService", label: null, notices: [], schedule: [] });

  it.each([
    ["the day before from keeps its timetable", "2026-12-14", 1, SUSPEND, scheduled("2026-12-14", 1)],
    ["from itself is no service", "2026-12-15", 2, SUSPEND, noService("2026-12-15", 2)],
    ["until itself is no service", "2026-12-16", 3, SUSPEND, noService("2026-12-16", 3)],
    ["the day after until keeps its timetable", "2026-12-17", 4, SUSPEND, scheduled("2026-12-17", 4)],
    ["no suspension keeps its timetable", "2026-12-15", 2, null, scheduled("2026-12-15", 2)],
    ["an invalid suspension keeps its timetable", "2026-12-15", 2, { from: "2026-12-16", until: "2026-12-15" }, scheduled("2026-12-15", 2)],
  ])("%s", (_case, date, dayOfWeek, suspend, expected) => {
    // Act & Assert
    expect(toSuspendedDay(scheduled(date, dayOfWeek), suspend)).toEqual(expected);
  });

  it("returns a copy, leaving the day it was given as it was", () => {
    // Arrange
    const day = scheduled("2026-12-15", 2);

    // Act
    toSuspendedDay(day, SUSPEND);

    // Assert
    expect(day).toEqual(scheduled("2026-12-15", 2));
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
