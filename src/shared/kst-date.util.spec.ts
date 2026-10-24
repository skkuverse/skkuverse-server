/**
 * toKstDate, the calendar date of an instant in Korea, which turns over at
 * 15:00 UTC; toKstInstant, an instant at +09:00 to the second, as every route
 * that serves an instant serves one (moved here from src/bus/bus.mapper.spec.ts).
 */
import { toKstDate, toKstInstant } from "./kst-date.util";

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
