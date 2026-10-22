/**
 * The realtime group mappers: a cached bus becomes the served bus (1-based
 * sequence → 0-based stationIndex, coordinates only when the source has them,
 * no buses before a route's first tick), an estimated bus says so in its kind,
 * a tracked bus carries its tracking under `tracked` with the running-only
 * fields only when running, and the clock reads as the KST wall time
 * "hh:mm AM/PM". A running or atStop bus serves its trajectory knots with
 * their instants at +09:00, and an instant reads
 * as ISO-8601 at +09:00.
 */
import { jongroPositionDoc } from "../../../../__tests__/helpers/bus/bus-cache-docs";
import { toClockTime, toDeprecatedCaller, toRealtimeBuses, toTrackedBus } from "./bus-realtime-group.mapper";
import type { JongroBusTracking } from "./bus-realtime-group.types";

describe("toRealtimeBuses", () => {
  it("maps buses with parseInt(sequence)-1 and conditional lat/lng spread", () => {
    // Act
    const buses = toRealtimeBuses([
      { sequence: "3", carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0" },
      { sequence: "1", carNumber: "5678", estimatedTime: 60 },
    ]);

    // Assert
    // WHY: every bus carries kind beside its other fields.
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
    trajectory: [{ atMs: Date.parse("2026-10-17T19:12:02+09:00"), s: 16.5 }],
  };

  it("serves a running bus with its legacy fields and its tracking", () => {
    // Act & Assert
    // WHY: a running or atStop bus carries a trajectory.
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
        trajectory: [{ at: "2026-10-17T19:12:02+09:00", s: 16.5 }],
      },
    });
  });

  it.each(["atStop", "waiting"] as const)("serves %s with the common fields only", (status) => {
    // Act
    const bus = toTrackedBus(position, { ...tracking, status, progress: 0, nextStopInSec: null });

    // Assert
    expect(bus).toMatchObject({ kind: "tracked" });
    // WHY: a running or atStop bus carries a trajectory.
    expect("tracked" in bus && bus.tracked).toEqual({
      status,
      vehicleId: "100000058",
      observedAt: "2026-10-17T19:12:02+09:00",
      crowding: "relaxed",
      isLastBus: false,
      ...(status === "atStop" && { trajectory: [{ at: "2026-10-17T19:12:02+09:00", s: 16.5 }] }),
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

describe("toTrackedBus with a trajectory", () => {
  // Route 02 vehicle 100000088 running at ord 8 at 18:07:45 (pos_/arr_100900008_1792314485).
  const position = jongroPositionDoc({ sequence: "8", carNumber: "5501", vehicleId: "100000088" });
  const tracking: JongroBusTracking = {
    status: "running",
    vehicleId: "100000088",
    observedAt: "2026-10-18T18:07:45+09:00",
    crowding: "relaxed",
    isLastBus: false,
    progress: 0.015 / 0.118,
    segmentMeters: 118,
    nextStopInSec: 23,
    trajectory: [
      { atMs: Date.parse("2026-10-18T18:07:45+09:00"), s: 7 + 0.015 / 0.118 },
      { atMs: Date.parse("2026-10-18T18:08:08+09:00"), s: 8 },
    ],
  };
  const served = [
    { at: "2026-10-18T18:07:45+09:00", s: 7 + 0.015 / 0.118 },
    { at: "2026-10-18T18:08:08+09:00", s: 8 },
  ];

  it.each(["running", "atStop"] as const)("serves a %s bus's knots with their instants at +09:00", (status) => {
    // Act
    const bus = toTrackedBus(position, { ...tracking, status });

    // Assert
    expect("tracked" in bus && bus.tracked).toMatchObject({ status, trajectory: served });
  });

  it("serves no trajectory for a waiting bus", () => {
    // Act
    const bus = toTrackedBus(position, { ...tracking, status: "waiting", trajectory: [] });

    // Assert
    expect("tracked" in bus && bus.tracked).not.toHaveProperty("trajectory");
  });
});

describe("toDeprecatedCaller", () => {
  it("reads the app's version and platform headers, null when absent or repeated", () => {
    // Act & Assert
    expect(toDeprecatedCaller({ "x-app-version": "3.6.2", "x-platform": "ios" })).toEqual({ appVersion: "3.6.2", platform: "ios" });
    expect(toDeprecatedCaller({ "x-app-version": ["3.6.2", "3.6.1"] })).toEqual({ appVersion: null, platform: null });
  });
});
