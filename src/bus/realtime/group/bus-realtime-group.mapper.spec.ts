/**
 * The realtime group mappers: a cached bus becomes the served bus (1-based
 * sequence → 0-based stationIndex, coordinates only when the source has them,
 * no buses before a route's first tick), an estimated bus says so in its kind,
 * a tracked bus carries its tracking under `tracked` with the running-only
 * fields only when running, and the clock reads as the KST wall time
 * "hh:mm AM/PM".
 */
import { jongroPositionDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { toClockTime, toRealtimeBuses, toTrackedBus } from "./bus-realtime-group.mapper";
import type { JongroBusTracking } from "./bus-realtime-group.types";

describe("toRealtimeBuses", () => {
  it("maps buses with parseInt(sequence)-1 and conditional lat/lng spread", () => {
    // Act
    const buses = toRealtimeBuses([
      { sequence: "3", carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0" },
      { sequence: "1", carNumber: "5678", estimatedTime: 60 },
    ]);

    // Assert
    // WHY: kind is the field add-jongro-bus-positions adds to every bus (task 2.2); the rest is as before.
    expect(buses[0]).toEqual({ stationIndex: 2, carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0", kind: "estimated" });
    expect(buses[1]).toEqual({ stationIndex: 0, carNumber: "5678", estimatedTime: 60, kind: "estimated" });
    expect(buses[1]).not.toHaveProperty("latitude");
  });

  it("serves no buses before the route's first tick", () => {
    // Act & Assert
    expect(toRealtimeBuses(undefined)).toEqual([]);
  });
});

describe("toTrackedBus", () => {
  const position = jongroPositionDoc({ sequence: "17", carNumber: "2008", estimatedTime: 0, latitude: "37.576595", longitude: "126.985792" });
  const tracking: JongroBusTracking = {
    status: "running",
    vehicleId: "100000058",
    observedAt: "2026-10-17T19:12:02+09:00",
    crowding: "relaxed",
    isLastBus: false,
    progress: 0.5,
    segmentMeters: 251,
    nextStopInSec: 28,
  };

  it("serves a running bus with its legacy fields and its tracking", () => {
    // Act & Assert
    expect(toTrackedBus(position, tracking)).toEqual({
      stationIndex: 16,
      carNumber: "2008",
      estimatedTime: 0,
      latitude: "37.576595",
      longitude: "126.985792",
      kind: "tracked",
      tracked: {
        status: "running",
        vehicleId: "100000058",
        observedAt: "2026-10-17T19:12:02+09:00",
        crowding: "relaxed",
        isLastBus: false,
        progress: 0.5,
        segmentMeters: 251,
        nextStopInSec: 28,
      },
    });
  });

  it.each(["atStop", "waiting"] as const)("serves %s with the common fields only", (status) => {
    // Act
    const bus = toTrackedBus(position, { ...tracking, status, progress: 0, nextStopInSec: null });

    // Assert
    expect(bus).toMatchObject({ kind: "tracked" });
    expect("tracked" in bus && bus.tracked).toEqual({
      status,
      vehicleId: "100000058",
      observedAt: "2026-10-17T19:12:02+09:00",
      crowding: "relaxed",
      isLastBus: false,
    });
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
