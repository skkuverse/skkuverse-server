/**
 * A bus group's date-range visibility is parsed when bus-config.data.ts is
 * imported: `from` and `until` are YYYY-MM-DD dates and `fromTime` is HH:mm
 * from 00:00 to 23:59, and `until` is not before `from`, so a typo fails the
 * boot instead of making the card silently never show.
 */
import { dateRange } from "../../../src/bus/bus-config/bus-config.data";

describe("dateRange", () => {
  it("keeps a valid window as written, with fromTime only when given", () => {
    // Act & Assert
    expect(dateRange("2026-10-12", "2026-12-18", "11:55")).toEqual({
      type: "dateRange",
      from: "2026-10-12",
      fromTime: "11:55",
      until: "2026-12-18",
    });
    expect(dateRange("2026-03-01", "2026-03-07")).toEqual({ type: "dateRange", from: "2026-03-01", until: "2026-03-07" });
    expect(Object.keys(dateRange("2026-03-01", "2026-03-07"))).toEqual(["type", "from", "until"]);
  });

  it.each(["00:00", "23:59"])("accepts fromTime %s", (fromTime) => {
    // Act & Assert
    expect(() => dateRange("2026-10-12", "2026-12-18", fromTime)).not.toThrow();
  });

  it.each(["24:00", "11:60", "1:55", "11:55:00", "11.55", ""])("throws on fromTime %p", (fromTime) => {
    // Act & Assert
    expect(() => dateRange("2026-10-12", "2026-12-18", fromTime)).toThrow(/fromTime/);
  });

  it.each([
    ["2026-13-01", "2026-12-18"],
    ["2026-10-12", "2026-02-30"],
    ["2026-1-12", "2026-12-18"],
    ["20261012", "2026-12-18"],
  ])("throws on from %p until %p", (from, until) => {
    // Act & Assert
    expect(() => dateRange(from, until)).toThrow();
  });

  it("throws when until is before from, a window no day falls in", () => {
    // Act & Assert
    expect(() => dateRange("2026-12-18", "2026-10-12")).toThrow(/until/);
  });

  it("accepts a one-day window, from and until the same date", () => {
    // Act & Assert
    expect(() => dateRange("2026-10-12", "2026-10-12")).not.toThrow();
  });
});
