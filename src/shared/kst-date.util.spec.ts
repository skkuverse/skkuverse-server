/**
 * toKstDate, the calendar date of an instant in Korea, which turns over at
 * 15:00 UTC; toKstInstant, an instant at +09:00 to the second, as every route
 * that serves an instant serves one (moved here from src/bus/bus.mapper.spec.ts);
 * toKstTimeOfDay, its KST wall-clock time as zero-padded `HH:mm`, which sorts
 * as it reads; isKstRestDay, whether its KST date is a Saturday, a Sunday or a
 * Korean public holiday.
 */
import { isKstRestDay, toKstDate, toKstInstant, toKstTimeOfDay } from "./kst-date.util";

describe("isKstRestDay", () => {
  it.each([
    ["2026-10-23T14:59:59Z", "Friday 23:59:59 KST", false],
    ["2026-10-23T15:00:00Z", "Saturday 00:00 KST, still Friday in UTC", true],
    ["2026-10-25T14:59:59Z", "Sunday 23:59:59 KST", true],
    ["2026-10-25T15:00:00Z", "Monday 00:00 KST, still Sunday in UTC", false],
    ["2026-10-08T16:30:00Z", "한글날 (Friday) 01:30 KST, still Thursday in UTC", true],
    ["2026-10-09T16:30:00Z", "the Saturday after it", true],
    ["2026-10-07T16:30:00Z", "Thursday 01:30 KST", false],
  ])("%s (%s) → %s", (instant, _when, isRestDay) => {
    // Act & Assert
    expect(isKstRestDay(new Date(instant))).toBe(isRestDay);
  });
});

describe("toKstDate", () => {
  it.each([
    ["2026-10-19T14:59:59Z", "2026-10-19"],
    ["2026-10-19T15:00:00Z", "2026-10-20"],
    ["2026-10-19T16:30:00Z", "2026-10-20"],
  ])("%s is %s in KST", (instant, expected) => {
    // Act & Assert
    expect(toKstDate(new Date(instant))).toBe(expected);
  });
});

describe("toKstInstant", () => {
  it.each([
    ["2026-10-19T16:30:00Z", "2026-10-20T01:30:00+09:00"],
    ["2026-10-18T09:07:45.400Z", "2026-10-18T18:07:45+09:00"],
  ])("%s reads %s", (instant, expected) => {
    // Act
    const read = toKstInstant(Date.parse(instant));

    // Assert
    expect(read).toBe(expected);
    expect(read).not.toBe(instant);
  });
});

describe("toKstTimeOfDay", () => {
  it.each([
    ["2026-10-19T16:30:00Z", "01:30"],
    ["2026-10-19T14:59:59Z", "23:59"],
    ["2026-10-19T15:00:00Z", "00:00"],
    ["2026-10-19T22:05:30Z", "07:05"],
  ])("%s is %s in KST", (instant, expected) => {
    // Act
    const read = toKstTimeOfDay(new Date(instant));

    // Assert
    expect(read).toBe(expected);
    expect(read).not.toBe(instant.slice(11, 16));
  });
});
