/**
 * toCall serves a domain call as the wire call (ADR 0022, D2): each instant at
 * +09:00 to the second, nulls kept, every key of the wire present in the wire's
 * own order whatever order the producer built them in, and nothing a producer
 * carries beside the call (a run's departure) served. It replaces the bus
 * module's toArrival (src/bus/bus.mapper.spec.ts), which kept each producer's
 * key order. A rider boards a call at its time, or at its expected arrival when
 * that is later, since a run running late leaves no earlier than it arrives
 * (toBoardTime), and leaves a run at its arrival, expected first (toAlightTime,
 * ADR 0022 D5 amended).
 */
import type { StopCall } from "./call.types";
import { toAlightTime, toBoardTime, toCall, toCallTime, toTimetabledCall } from "./call.util";
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

describe("toCallTime", () => {
  const at = (iso: string) => new Date(iso);
  const NONE = { expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null };

  it.each([
    ["the expected departure first", { expectedDepartureAt: at("2026-10-22T01:02:00Z"), scheduledDepartureAt: at("2026-10-22T01:00:00Z"), expectedArrivalAt: at("2026-10-22T00:59:00Z") }, "2026-10-22T01:02:00.000Z"],
    ["then the scheduled departure", { scheduledDepartureAt: at("2026-10-22T01:00:00Z"), expectedArrivalAt: at("2026-10-22T00:59:00Z"), scheduledArrivalAt: at("2026-10-22T00:58:00Z") }, "2026-10-22T01:00:00.000Z"],
    ["then the expected arrival", { expectedArrivalAt: at("2026-10-22T00:59:00Z"), scheduledArrivalAt: at("2026-10-22T00:58:00Z") }, "2026-10-22T00:59:00.000Z"],
    ["then the scheduled arrival", { scheduledArrivalAt: at("2026-10-22T00:58:00Z") }, "2026-10-22T00:58:00.000Z"],
  ])("reads %s", (_case, instants, expected) => {
    // Act
    const time = toCallTime({ ...NONE, ...instants });

    // Assert
    expect(time?.toISOString()).toBe(expected);
  });

  it("is null for a call with no instant", () => {
    // Act & Assert
    expect(toCallTime(NONE)).toBeNull();
  });
});

describe("toTimetabledCall", () => {
  const RUN = { runId: "campus-inja|regular|2026-10-20|14:00", headsign: "인사캠 → 자과캠", isFirstRun: true, isLastRun: false };
  const SHOWN = new Date("2026-10-20T06:10:00Z");
  const TIMETABLE = new Date("2026-10-20T06:00:00Z");

  it("Boarding stop: the timetable time is the scheduled departure, basis timetable", () => {
    // Act
    const boarding = toTimetabledCall({ shownAt: TIMETABLE, timetableAt: TIMETABLE, isEstimated: false }, "board", RUN);

    // Assert
    expect(boarding).toEqual({
      status: "scheduled",
      expectedArrivalAt: null,
      expectedDepartureAt: null,
      scheduledArrivalAt: null,
      scheduledDepartureAt: TIMETABLE,
      basis: "timetable",
      stopsAway: null,
      ...{ runId: RUN.runId, vehicleId: null, headsign: RUN.headsign, isFirstRun: true, isLastRun: false, isExpress: null, providerText: null },
    });
  });

  it("Estimated alighting stop: the estimate is the expected arrival beside the timetable's own, basis estimate", () => {
    // Act
    const alighting = toTimetabledCall({ shownAt: SHOWN, timetableAt: TIMETABLE, isEstimated: true }, "alight", RUN);

    // Assert
    expect(alighting).toMatchObject({ expectedArrivalAt: SHOWN, scheduledArrivalAt: TIMETABLE, expectedDepartureAt: null, scheduledDepartureAt: null, basis: "estimate" });
  });

  it("No time at the stop: every instant null and basis timetable, even when flagged estimated", () => {
    // Act
    const unknown = toTimetabledCall({ shownAt: null, timetableAt: null, isEstimated: true }, "alight", RUN);

    // Assert
    expect(unknown).toMatchObject({ expectedArrivalAt: null, scheduledArrivalAt: null, basis: "timetable" });
  });
});

describe("toBoardTime", () => {
  const at = (clock: string) => new Date(`2026-10-20T${clock}+09:00`);
  const NONE = { expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null };
  const LIVE_TRAIN = { ...NONE, scheduledArrivalAt: at("08:03:00"), scheduledDepartureAt: at("08:03:30") };

  it.each([
    ["one second before its scheduled departure", "08:03:29", "08:03:30"],
    ["at its scheduled departure", "08:03:30", "08:03:30"],
    ["one second after it, running late", "08:03:31", "08:03:31"],
  ])("boards a train expected to arrive %s at %s", (_case, expectedAt, boardAt) => {
    // Act
    const time = toBoardTime({ ...LIVE_TRAIN, expectedArrivalAt: at(expectedAt) });

    // Assert
    expect(time).toEqual(at(boardAt));
  });

  it("is the call's time when it has no expected arrival, and null with no instant", () => {
    // Act & Assert
    expect([toBoardTime(LIVE_TRAIN), toBoardTime({ ...NONE, expectedDepartureAt: at("08:10:00") }), toBoardTime(NONE)]).toEqual([at("08:03:30"), at("08:10:00"), null]);
  });
});

describe("toAlightTime", () => {
  const at = (clock: string) => new Date(`2026-10-20T${clock}+09:00`);
  const NONE = { expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null };

  it.each([
    ["the expected arrival first", { expectedArrivalAt: at("08:58:40"), scheduledArrivalAt: at("08:58:00"), scheduledDepartureAt: at("08:58:30") }, at("08:58:40")],
    ["then the scheduled arrival", { scheduledArrivalAt: at("08:58:00"), expectedDepartureAt: at("08:58:50"), scheduledDepartureAt: at("08:58:30") }, at("08:58:00")],
    ["then the expected departure", { expectedDepartureAt: at("08:58:50"), scheduledDepartureAt: at("08:58:30") }, at("08:58:50")],
    ["then the scheduled departure", { scheduledDepartureAt: at("08:58:30") }, at("08:58:30")],
  ])("reads %s", (_case, instants, expected) => {
    // Act & Assert
    expect(toAlightTime({ ...NONE, ...instants })).toEqual(expected);
  });
});
