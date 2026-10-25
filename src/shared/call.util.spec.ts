/**
 * toCall serves a domain call as the wire call (ADR 0022, D2): each instant at
 * +09:00 to the second, nulls kept, every key of the wire present in the wire's
 * own order whatever order the producer built them in, and nothing a producer
 * carries beside the call (a run's departure) served. It replaces the bus
 * module's toArrival (src/bus/bus.mapper.spec.ts), which kept each producer's
 * key order.
 */
import type { StopCall } from "./call.types";
import { toCall } from "./call.util";
import { call as callWire } from "./call.wire";

const WIRE_KEYS = Object.keys(callWire.shape);

const stopCall = (extra: Partial<StopCall> = {}): StopCall => ({
  status: "scheduled",
  expectedArrivalAt: new Date("2026-10-22T15:52:00Z"),
  expectedDepartureAt: null,
  scheduledArrivalAt: new Date("2026-10-22T15:50:00Z"),
  scheduledDepartureAt: new Date("2026-10-22T14:30:00.400Z"),
  basis: "estimate",
  stopsAway: null,
  runId: "commute-jamsil|down|2026-10-22|23:30",
  vehicleId: null,
  headsign: "잠실",
  isFirstRun: false,
  isLastRun: true,
  isExpress: null,
  providerText: null,
  ...extra,
});

describe("toCall", () => {
  it("serves each instant at +09:00 to the second, KST's date past midnight where UTC's is the day before, and keeps nulls", () => {
    // Act
    const served = toCall(stopCall());

    // Assert
    expect(served).toEqual({
      status: "scheduled",
      expectedArrivalAt: "2026-10-23T00:52:00+09:00",
      expectedDepartureAt: null,
      scheduledArrivalAt: "2026-10-23T00:50:00+09:00",
      scheduledDepartureAt: "2026-10-22T23:30:00+09:00",
      basis: "estimate",
      stopsAway: null,
      runId: "commute-jamsil|down|2026-10-22|23:30",
      vehicleId: null,
      headsign: "잠실",
      isFirstRun: false,
      isLastRun: true,
      isExpress: null,
      providerText: null,
    });
    expect(served.expectedArrivalAt).not.toContain("2026-10-22T15");
  });

  it("serves the wire's keys in the wire's order, whatever order the producer built them in", () => {
    // Arrange
    const { providerText, isLastRun, status, ...rest } = stopCall({ status: "arriving", basis: "provider", stopsAway: 0, vehicleId: "100000702" });
    const reordered: StopCall = { providerText, isLastRun, ...rest, status };

    // Act
    const served = toCall(reordered);

    // Assert
    expect(Object.keys(served)).toEqual(WIRE_KEYS);
    expect(Object.keys(reordered)).not.toEqual(WIRE_KEYS);
  });

  it("serves nothing a producer carries beside the call, such as a run's departure", () => {
    // Arrange
    const run = { ...stopCall(), runDepartureAt: new Date("2026-10-22T14:30:00Z") };

    // Act
    const served = toCall(run);

    // Assert
    expect(served).not.toHaveProperty("runDepartureAt");
    expect(Object.keys(served)).toEqual(WIRE_KEYS);
  });
});
