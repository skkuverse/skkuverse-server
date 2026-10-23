/**
 * The calendar check every stored date shares: a date is a real day written
 * YYYY-MM-DD, so a push cannot store a day the calendar does not have, or one
 * the strict reads would not find.
 */
import { isCalendarDate } from "./calendar-date.util";

describe("isCalendarDate", () => {
  it.each([
    ["2026-12-21", true],
    ["2028-02-29", true],
    ["2027-02-29", false],
    ["2026-02-28", true],
    ["2026-12-31", true],
    ["2026-12-32", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-12-1", false],
    ["26-12-21", false],
    ["2026-12-21T00:00", false],
    ["", false],
  ])("%j is a calendar date: %s", (value, expected) => {
    // Act & Assert
    expect(isCalendarDate(value)).toBe(expected);
  });
});
