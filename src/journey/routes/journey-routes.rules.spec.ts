/**
 * The journey planner (ADR 0022, D5 and D7; docs/plans/transit-route-planner.md "The planner"): each ride boards the
 * first run the rider can catch after the legs before it, a catch margin ahead of their arrival at the stop, skipping
 * a vehicle with no seat left; the legs before the first ride are timed back from that boarding, so the option leaves
 * when it must, never before now; the wait is the boarding minus the arrival at the stop; up to two later catchable
 * calls are kept; the alight is the door's call for the same run, else the boarding plus the leg's ride minutes as an
 * estimate; past a source's listed vehicles a headway boards half a headway after the rider is ready, as an estimate;
 * an option with no run left is not running, ended, with the board's next service, and one whose door failed is
 * unavailable; a ride ends at its alight call's arrival, before the run leaves that stop, so the next leg starts
 * there (ADR 0022, D5, amended 2026-10-25); a leg's basis is the weaker of its calls; options run by arrival, data
 * order breaking a tie, then the ones not running in data order.
 */
import type { StopCall } from "../../shared/call.types";
import type { Departure, DepartureBoard } from "../../shared/departure.types";
import type { JourneyLine, JourneyOption } from "../journey.document";
import { planOption, toLegBasis, toOptionOrder } from "./journey-routes.rules";
import type { PlanContext, PlannedOption, PlannedRide, PlannedStep } from "./journey-routes.types";

const kst = (time: string) => new Date(`2026-10-20T${time}:00+09:00`);
const NAME = { ko: "인자셔틀", en: "INJA Shuttle", zh: "仁自班车" };
const LINE: JourneyLine = { id: "inja", source: "busTimetable", sourceLineId: "campus-inja", mode: "shuttle", name: NAME, color: "003626", icon: "shuttle" };

const OPTION: JourneyOption = {
  id: "inja",
  name: NAME,
  mode: "shuttle",
  legs: [
    { kind: "walk", from: "skku_building:1", to: "bus_stop:hssc-bus-lot", minutes: 6, distanceM: 473, evidence: "TMAP" },
    { kind: "ride", line: "inja", board: { place: "bus_stop:hssc-bus-lot" }, alight: { place: "bus_stop:nsc-n-center" }, rideMinutes: 82, evidence: "baseline" },
    { kind: "walk", from: "bus_stop:nsc-n-center", to: "skku_building:7", minutes: 4, distanceM: 269, evidence: "TMAP" },
  ],
};

function call(at: Date, extra: Partial<StopCall> = {}): StopCall {
  return {
    status: "scheduled",
    ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: at },
    basis: "timetable",
    ...{ stopsAway: null, runId: `run-${at.toISOString()}`, vehicleId: null, headsign: "인사캠 → 자과캠" },
    ...{ isFirstRun: false, isLastRun: false, isExpress: null, providerText: null },
    ...extra,
  };
}

const departure = (time: string, alight: StopCall | null = null, extra: Partial<StopCall> = {}): Departure => ({ lineId: "campus-inja", board: call(kst(time), extra), alight, observedAt: null });

function board(departures: Departure[], extra: Partial<DepartureBoard> = {}): DepartureBoard {
  return { departures, vehicles: {}, continuation: { kind: "listed" }, nextServiceAt: null, ...extra };
}

const context = (now: Date, rideBoard: DepartureBoard | Error): PlanContext => ({ now, catchMarginSec: 60, lineById: new Map([["inja", LINE]]), boards: new Map([[1, rideBoard]]) });

type Running = Extract<PlannedOption, { status: "running" }>;
function running(planned: PlannedOption): Running {
  if (planned.status !== "running") throw new Error(`expected a running option, got ${JSON.stringify(planned)}`);
  return planned;
}
const rideOf = (planned: PlannedOption) => running(planned).legs[1] as PlannedRide;
const stepAt = (planned: PlannedOption, index: number) => running(planned).legs[index] as PlannedStep;

describe("planOption", () => {
  it("boards the first run catchable after the walk and the margin, timing the walk back from it", () => {
    // Arrange
    const runs = board([departure("14:05"), departure("14:30"), departure("15:00"), departure("15:30"), departure("16:00")]);

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).board.scheduledDepartureAt).toEqual(kst("14:30"));
    expect(running(planned).leaveAt).toEqual(kst("14:23"));
    expect([stepAt(planned, 0).startAt, stepAt(planned, 0).endAt]).toEqual([kst("14:23"), kst("14:29")]);
    expect(rideOf(planned).waitSec).toBe(60);
    expect(rideOf(planned).later.map((later) => later.scheduledDepartureAt)).toEqual([kst("15:00"), kst("15:30")]);
  });

  it.each([
    ["one second before the rider is ready", "14:06:59", "14:30"],
    ["when the rider is ready", "14:07:00", "14:07"],
    ["one second after", "14:07:01", "14:07"],
  ])("Catch margin: a run leaving %s is boarded only from then on", (_case, departsAt, boarded) => {
    // Arrange
    const runs = board([{ ...departure("14:00"), board: call(new Date(`2026-10-20T${departsAt}+09:00`)) }, departure("14:30")]);
    const expected = boarded === "14:30" ? kst("14:30") : new Date(`2026-10-20T${departsAt}+09:00`);

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).board.scheduledDepartureAt).toEqual(expected);
  });

  it("leaves the walk and the margin before the boarding, and waits the margin from the arrival at the stop", () => {
    // Arrange
    const runs = board([departure("14:08")]);

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(running(planned).leaveAt).toEqual(kst("14:01"));
    expect(rideOf(planned).waitSec).toBe(60);
  });

  it("alights by the door's call for the same run, else by the ride minutes as an estimate, and arrives after the last walk", () => {
    // Arrange
    const withAlight = board([departure("14:30", call(kst("15:40"), { scheduledDepartureAt: null, expectedArrivalAt: kst("15:40"), basis: "estimate" }))]);
    const withoutAlight = board([departure("14:30")]);

    // Act
    const joined = planOption(OPTION, context(kst("14:00"), withAlight));
    const fallback = planOption(OPTION, context(kst("14:00"), withoutAlight));

    // Assert
    expect(running(joined).arriveAt).toEqual(kst("15:44"));
    expect(rideOf(fallback).alight).toMatchObject({ status: "unknown", expectedArrivalAt: kst("15:52"), basis: "estimate", runId: rideOf(fallback).board.runId });
    expect(running(fallback).arriveAt).toEqual(kst("15:56"));
  });

  it("Full bus: skips a vehicle with no seat left and boards one whose seats are unknown", () => {
    // Arrange
    const runs = board([departure("14:20", null, { vehicleId: "full" }), departure("14:25", null, { vehicleId: "unknown" })], {
      vehicles: { full: { id: "full", occupancy: null, seatsLeft: 0, isLowFloor: null }, unknown: { id: "unknown", occupancy: null, seatsLeft: null, isLowFloor: null } },
    });

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).board.vehicleId).toBe("unknown");
    expect(rideOf(planned).vehicles.map((vehicle) => vehicle.id)).toEqual(["unknown"]);
  });

  it("Past the listed vehicles: boards half a headway after the rider is ready, as an estimate naming no vehicle", () => {
    // Arrange
    const runs = board([departure("14:05")], { continuation: { kind: "headway", headwaySec: 600, serviceEndsAt: kst("23:00") } });

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).board).toMatchObject({ status: "unknown", expectedArrivalAt: kst("14:12"), basis: "estimate", vehicleId: null, runId: null });
  });

  it("Ended: names the board's next service when no run is left", () => {
    // Arrange
    const runs = board([departure("19:00")], { nextServiceAt: new Date("2026-10-21T08:00:00+09:00") });

    // Act
    const planned = planOption(OPTION, context(kst("21:00"), runs));

    // Assert
    expect(planned).toEqual({ status: "notRunning", reason: "ended", nextServiceAt: new Date("2026-10-21T08:00:00+09:00") });
  });

  it("Alight time: ends a 1호선 ride at its alight call's arrival, not its departure, and starts the walk after it there", () => {
    // Arrange
    const at = (clock: string) => new Date(`2026-10-20T${clock}+09:00`);
    const line1: JourneyLine = { id: "line1", source: "subway", sourceLineId: "1", mode: "subway", name: { ko: "1호선", en: "Line 1", zh: "1号线" }, color: "0052A4", icon: "subway" };
    const option: JourneyOption = {
      id: "line1",
      name: line1.name,
      mode: "subway",
      legs: [
        { kind: "walk", from: "skku_building:1", to: "subway_station:geumjeong", minutes: 5, distanceM: 400, evidence: "TMAP" },
        { kind: "ride", line: "line1", board: { place: "subway_station:geumjeong", platformId: "KR-1-P149" }, alight: { place: "subway_station:sungkyunkwan", platformId: "KR-1-P153" }, rideMinutes: 11, evidence: "timetable" },
        { kind: "walk", from: "subway_station:sungkyunkwan", to: "skku_building:7", minutes: 23, distanceM: 1590, evidence: "TMAP" },
      ],
    };
    const alight = call(at("08:58:30"), { scheduledArrivalAt: at("08:58:00"), runId: "1/2026-10-20/1907" });
    const runs = board([{ lineId: "1", board: call(at("08:49:00"), { scheduledArrivalAt: at("08:48:30"), runId: "1/2026-10-20/1907" }), alight, observedAt: null }]);

    // Act
    const planned = planOption(option, { now: at("08:40:00"), catchMarginSec: 60, lineById: new Map([["line1", line1]]), boards: new Map([[1, runs]]) });

    // Assert
    expect(rideOf(planned).alight).toEqual(alight);
    expect([stepAt(planned, 2).startAt, stepAt(planned, 2).endAt]).toEqual([at("08:58:00"), at("09:21:00")]);
    expect(running(planned).arriveAt).toEqual(at("09:21:00"));
  });

  it("is unavailable when the door could not answer", () => {
    // Act
    const planned = planOption(OPTION, context(kst("14:00"), new Error("stops unavailable")));

    // Assert
    expect(planned).toEqual({ status: "notRunning", reason: "unavailable", nextServiceAt: null });
  });
});

describe("toLegBasis", () => {
  it.each([
    ["timetable", "timetable", "timetable"],
    ["timetable", "provider", "provider"],
    ["provider", "estimate", "estimate"],
    ["estimate", "timetable", "estimate"],
  ] as const)("is %s and %s → %s", (boardBasis, alightBasis, expected) => {
    // Act & Assert
    expect(toLegBasis(call(kst("14:00"), { basis: boardBasis }), call(kst("15:00"), { basis: alightBasis }))).toBe(expected);
  });
});

describe("toOptionOrder", () => {
  const runningAt = (arriveAt: string): PlannedOption => ({ status: "running", leaveAt: kst("14:00"), arriveAt: kst(arriveAt), legs: [] });
  const ended: PlannedOption = { status: "notRunning", reason: "ended", nextServiceAt: null };

  it("runs options by arrival, data order breaking a tie, then the ones not running in data order", () => {
    // Act
    const order = toOptionOrder([ended, runningAt("15:56"), runningAt("15:10"), { ...ended, reason: "unavailable" }, runningAt("15:10")]);

    // Assert
    expect(order).toEqual([2, 4, 1, 0, 3]);
  });
});
