/**
 * The realtime group mappers: a cached bus becomes the served bus (1-based
 * sequence → 0-based stationIndex, coordinates only when the source has them,
 * no buses before a route's first tick), and the clock reads as the KST wall
 * time "hh:mm AM/PM".
 */
import { toClockTime, toRealtimeBuses } from "./bus-realtime-group.mapper";

describe("toRealtimeBuses", () => {
  it("maps buses with parseInt(sequence)-1 and conditional lat/lng spread", () => {
    // Act
    const buses = toRealtimeBuses([
      { sequence: "3", carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0" },
      { sequence: "1", carNumber: "5678", estimatedTime: 60 },
    ]);

    // Assert
    expect(buses[0]).toEqual({ stationIndex: 2, carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0" });
    expect(buses[1]).toEqual({ stationIndex: 0, carNumber: "5678", estimatedTime: 60 });
    expect(buses[1]).not.toHaveProperty("latitude");
  });

  it("serves no buses before the route's first tick", () => {
    // Act & Assert
    expect(toRealtimeBuses(undefined)).toEqual([]);
  });
});

describe("toClockTime", () => {
  it.each([
    ["2026-10-20T01:00:00Z", "10:00 AM"],
    ["2026-10-20T13:26:00Z", "10:26 PM"],
    ["2026-10-19T15:05:00Z", "12:05 AM"],
  ])("%s reads %s in KST", (instant, expected) => {
    // Act & Assert
    expect(toClockTime(new Date(instant))).toBe(expected);
  });
});
