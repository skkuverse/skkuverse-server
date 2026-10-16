/**
 * toKstDate, the calendar date of an instant in Korea, which turns over at
 * 15:00 UTC.
 */
import { toKstDate } from "./kst-date.util";

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
