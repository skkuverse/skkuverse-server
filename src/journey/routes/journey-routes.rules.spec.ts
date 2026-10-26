/**
 * The journey planner (ADR 0022, D5 and D7; docs/plans/transit-route-planner.md "The planner"): each ride boards the
 * first run the rider can catch after the legs before it, a catch margin ahead of their arrival at the stop, skipping
 * a vehicle with no seat left; the legs before the first ride are timed back from that boarding, so the option leaves
 * when it must, never before now; the wait is the boarding minus the arrival at the stop; up to two later catchable
 * listed calls are kept, a full vehicle skipped, and never a headway estimate (ADR 0022 PR (h)); the alight is the door's call for the same run, else the boarding plus the leg's ride minutes as an
 * estimate, those of the band of the day type (weekday, or weekend and public holiday) the board's KST time falls in, the flat ones outside every band; past a source's listed vehicles a headway boards half a headway after the rider is ready, as an estimate;
 * an option with no run left is not running, with the board's next service: not started when that falls later in the
 * same service day as now (03:00 to 03:00 KST), ended when in a later one or unknown, so between the last run and
 * 03:00 it is ended (ADR 0022 PR (h)); one whose door failed is
 * unavailable; when a later ride has no run left, the option is ended too, its next service the boarding of the first
 * ride that reaches that ride's next first run, never before the first ride's own next run; a ride ends at its alight call's arrival, before the run leaves that stop, so the next leg starts
 * there (ADR 0022, D5, amended 2026-10-25), and a run running late, past its scheduled departure, boards at its
 * expected arrival (toBoardTime); a connection between two rides warns `tightTransfer` when the rider has under 120 s
 * at the stop before the next ride, and `connectionAtRisk` when that is under the arrival's uncertainty (150 s for an
 * estimate, plus half the headway for a ride boarded on one) or 150 s before a named run's estimated board; a leg's basis is the weaker of its calls; options run by arrival, data
 * order breaking a tie, then the ones not running in data order; a ride's `upcoming` lists at most the next two listed
 * calls at its board stop from now, with no catch margin, a full vehicle skipped and never a headway estimate, and
 * their vehicles join the ride's, and its `stops` are those its door lists between the board and alight stops, null
 * when the door cannot list them (2026-10-26).
 */
import type { StopCall } from "../../shared/call.types";
import { toBoardTime } from "../../shared/call.util";
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

  describe("Ride minutes by time of day: a run with no alight call takes the band its board's KST time falls in", () => {
    const BANDS = { weekday: [{ from: "07:00", minutes: 90 }, { from: "17:00", minutes: 100 }], weekend: [{ from: "13:00", minutes: 70 }] };
    const banded: JourneyOption = { ...OPTION, legs: OPTION.legs.map((leg) => (leg.kind === "ride" ? { ...leg, rideMinutesBands: BANDS } : leg)) };
    const MINUTE_MS = 60_000;

    it.each([
      ["2026-10-20T06:59:00+09:00", "a weekday before its first band, the flat minutes", 82],
      ["2026-10-20T07:00:00+09:00", "a weekday at its first band's start", 90],
      ["2026-10-20T16:59:00+09:00", "a weekday a minute before the next band", 90],
      ["2026-10-20T17:00:00+09:00", "a weekday at the next band's start", 100],
      ["2026-10-20T23:59:00+09:00", "the last band, until midnight", 100],
      ["2026-10-21T00:30:00+09:00", "past midnight, 15:30 Tuesday in UTC, the flat minutes again", 82],
      ["2026-10-24T07:00:00+09:00", "a Saturday at a weekday band's start, the flat minutes", 82],
      ["2026-10-24T12:59:00+09:00", "a Saturday before its weekend band", 82],
      ["2026-10-24T13:00:00+09:00", "a Saturday at its weekend band", 70],
      ["2026-10-09T13:00:00+09:00", "한글날, a Friday holiday, as a weekend", 70],
    ])("boarding %s (%s) rides %i minutes", (boardAt, _case, minutes) => {
      // Arrange
      const boardAtMs = Date.parse(boardAt);
      const runs = board([{ lineId: "campus-inja", board: call(new Date(boardAtMs)), alight: null, observedAt: null }]);

      // Act
      const planned = planOption(banded, context(new Date(boardAtMs - 7 * MINUTE_MS), runs));

      // Assert
      expect(rideOf(planned).alight.expectedArrivalAt).toEqual(new Date(boardAtMs + minutes * MINUTE_MS));
      expect(rideOf(planned).alight.basis).toBe("estimate");
    });

    it("keeps the door's alight call whatever band the board falls in", () => {
      // Arrange
      const runs = board([departure("17:00", call(kst("17:40"), { scheduledDepartureAt: null, expectedArrivalAt: kst("17:40"), basis: "estimate" }))]);

      // Act
      const planned = planOption(banded, context(kst("16:53"), runs));

      // Assert
      expect(rideOf(planned).alight.expectedArrivalAt).toEqual(kst("17:40"));
    });
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

  describe("Later calls: the next two catchable listed calls after the boarded one, never a headway estimate", () => {
    const seats = (id: string, seatsLeft: number | null) => ({ id, occupancy: null, seatsLeft, isLowFloor: null });
    const HEADWAY = { kind: "headway", headwaySec: 600, serviceEndsAt: kst("23:00") } as const;

    it("lists the predicted vehicles after the boarded one, skipping a full one, at most two", () => {
      // Arrange
      const vehicles = { a: seats("a", 3), full: seats("full", 0), b: seats("b", null), c: seats("c", 9), d: seats("d", 1) };
      const runs = board(["a", "full", "b", "c", "d"].map((id, index) => departure(`14:1${index}`, null, { vehicleId: id, basis: "provider" })), { vehicles, continuation: HEADWAY });

      // Act
      const planned = planOption(OPTION, context(kst("14:00"), runs));

      // Assert
      expect([rideOf(planned).board.vehicleId, ...rideOf(planned).later.map((later) => later.vehicleId)]).toEqual(["a", "b", "c"]);
      expect(rideOf(planned).vehicles.map((vehicle) => vehicle.id)).toEqual(["a", "b", "c"]);
    });

    it("lists only the listed vehicle left, and nothing after a headway board, though a headway follows", () => {
      // Arrange
      const oneLeft = board([departure("14:10", null, { vehicleId: "a" }), departure("14:20", null, { vehicleId: "b" })], { continuation: HEADWAY });
      const headwayOnly = board([departure("14:05", null, { vehicleId: "a" })], { continuation: HEADWAY });

      // Act
      const [listed, headway] = [planOption(OPTION, context(kst("14:00"), oneLeft)), planOption(OPTION, context(kst("14:00"), headwayOnly))];

      // Assert
      expect(rideOf(listed).later.map((later) => later.vehicleId)).toEqual(["b"]);
      expect([rideOf(headway).board.basis, rideOf(headway).later]).toEqual(["estimate", []]);
    });
  });

  it("Past the listed vehicles: boards half a headway after the rider is ready, as an estimate naming no vehicle", () => {
    // Arrange
    const runs = board([departure("14:05")], { continuation: { kind: "headway", headwaySec: 600, serviceEndsAt: kst("23:00") } });

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).board).toMatchObject({ status: "unknown", expectedArrivalAt: kst("14:12"), basis: "estimate", vehicleId: null, runId: null });
  });

  it.each([
    ["one second before the rider is ready", "14:06:59", "14:30:00"],
    ["when the rider is ready", "14:07:00", "14:07:00"],
  ])("Late train: boards a live run expected to arrive %s, past its scheduled departure, at that arrival", (_case, expectedAt, boardAt) => {
    // Arrange
    const late = departure("14:05", null, { expectedArrivalAt: new Date(`2026-10-20T${expectedAt}+09:00`), basis: "provider" });
    const runs = board([late, departure("14:30")]);

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(toBoardTime(rideOf(planned).board)).toEqual(new Date(`2026-10-20T${boardAt}+09:00`));
    expect(running(planned).leaveAt).toEqual(new Date(Date.parse(`2026-10-20T${boardAt}+09:00`) - 7 * 60_000));
  });

  it("Ended: names the board's next service when no run is left", () => {
    // Arrange
    const runs = board([departure("19:00")], { nextServiceAt: new Date("2026-10-21T08:00:00+09:00") });

    // Act
    const planned = planOption(OPTION, context(kst("21:00"), runs));

    // Assert
    expect(planned).toEqual({ status: "notRunning", reason: "ended", nextServiceAt: new Date("2026-10-21T08:00:00+09:00") });
  });

  it.each([
    ["later the same service day, though another UTC date", "2026-10-20T08:30:00+09:00", "2026-10-20T10:00:00+09:00", "notStarted"],
    ["one second before 03:00 KST, when the next service day starts", "2026-10-20T21:00:00+09:00", "2026-10-21T02:59:59+09:00", "notStarted"],
    ["at that 03:00", "2026-10-20T21:00:00+09:00", "2026-10-21T03:00:00+09:00", "ended"],
    ["one second after it", "2026-10-20T21:00:00+09:00", "2026-10-21T03:00:01+09:00", "ended"],
    ["of the morning, asked one second before 03:00, after the last run", "2026-10-21T02:59:59+09:00", "2026-10-21T06:00:00+09:00", "ended"],
    ["of the morning, asked at 03:00", "2026-10-21T03:00:00+09:00", "2026-10-21T06:00:00+09:00", "notStarted"],
    ["of the morning, asked one second after 03:00", "2026-10-21T03:00:01+09:00", "2026-10-21T06:00:00+09:00", "notStarted"],
    ["of the morning, asked at 04:00", "2026-10-21T04:00:00+09:00", "2026-10-21T06:00:00+09:00", "notStarted"],
  ])("Not started: with no run in the window, a next service %s is %s", (_case, nowAt, nextAt, reason) => {
    // Arrange
    const runs = board([], { nextServiceAt: new Date(nextAt) });

    // Act
    const planned = planOption(OPTION, context(new Date(nowAt), runs));

    // Assert
    expect(planned).toEqual({ status: "notRunning", reason, nextServiceAt: new Date(nextAt) });
  });

  it("Not started: is ended with no next service known", () => {
    // Act
    const planned = planOption(OPTION, context(kst("08:30"), board([])));

    // Assert
    expect(planned).toEqual({ status: "notRunning", reason: "ended", nextServiceAt: null });
  });

  describe("Ended later leg: 4호선 still runs, the last 7800 has left 사당 by the time the rider gets there", () => {
    const at = (clock: string, day = "20") => new Date(`2026-10-${day}T${clock}:00+09:00`);
    const line4: JourneyLine = { id: "line4", source: "subway", sourceLineId: "4", mode: "subway", name: { ko: "4호선", en: "Line 4", zh: "4号线" }, color: "00A5DE", icon: "subway" };
    const bus7800: JourneyLine = { id: "bus7800", source: "topis", sourceLineId: "gyeonggi7800", mode: "expressBus", name: { ko: "7800", en: "7800", zh: "7800" }, color: "E60012", icon: "expressBus" };
    const option: JourneyOption = {
      id: "line4-7800",
      name: { ko: "4호선 · 7800", en: "Line 4 · 7800", zh: "4号线 · 7800" },
      mode: "expressBus",
      legs: [
        { kind: "walk", from: "skku_building:1", to: "subway_station:hyehwa", minutes: 8, distanceM: 568, evidence: "TMAP" },
        { kind: "ride", line: "line4", board: { place: "subway_station:hyehwa", platformId: "S1-4-420" }, alight: { place: "subway_station:sadang", platformId: "S1-4-433" }, rideMinutes: 28, evidence: "timetable" },
        { kind: "walk", from: "subway_station:sadang", to: "bus_stop:119000302", minutes: 2, distanceM: 101, evidence: "TMAP" },
        { kind: "ride", line: "bus7800", board: { place: "bus_stop:119000302" }, alight: { place: "bus_stop:200000159" }, rideMinutes: 34, evidence: "TOPIS" },
        { kind: "walk", from: "bus_stop:200000159", to: "skku_building:7", minutes: 15, distanceM: 1063, evidence: "TMAP" },
      ],
    };
    // The 23:30 train from Hyehwa reaches Sadang at 23:58; the rider is at the 7800 pole, a margin ahead, at 00:01.
    const subway = (nextServiceAt: Date | null) => board([{ lineId: "4", board: call(at("23:30")), alight: call(at("23:58")), observedAt: null }], { nextServiceAt });
    const plan = (subwayNext: Date | null, busNext: Date | null) =>
      planOption(option, { now: at("23:20"), catchMarginSec: 60, lineById: new Map([["line4", line4], ["bus7800", bus7800]]), boards: new Map([[1, subway(subwayNext)], [3, board([], { nextServiceAt: busNext })]]) });

    it("is ended, its next service the 4호선 boarding that reaches 7800's next first run", () => {
      // Act
      const planned = plan(at("05:00", "21"), at("05:52", "21"));

      // Assert
      expect(planned).toEqual({ status: "notRunning", reason: "ended", nextServiceAt: at("05:21", "21") });
    });

    it.each([
      ["one minute before", "05:20", "05:21"],
      ["at that boarding", "05:21", "05:21"],
      ["one minute after", "05:22", "05:22"],
    ])("never names a next service before the first ride's own next run, %s", (_case, subwayNext, expected) => {
      // Act & Assert
      expect(plan(at(subwayNext, "21"), at("05:52", "21"))).toMatchObject({ nextServiceAt: at(expected, "21") });
    });

    it("names no next service when the ended leg knows none", () => {
      // Act & Assert
      expect(plan(at("05:00", "21"), null)).toEqual({ status: "notRunning", reason: "ended", nextServiceAt: null });
    });
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

  describe("Warnings: a connection between two rides", () => {
    // WHY: ride 1 leaves stop a at 14:10 and reaches b at 14:40; the walk reaches c at 14:42, where ride 3 boards.
    const TWO_RIDES: JourneyOption = {
      id: "two-rides",
      name: NAME,
      mode: "shuttle",
      legs: [
        { kind: "walk", from: "skku_building:1", to: "bus_stop:a", minutes: 5, distanceM: 400, evidence: "TMAP" },
        { kind: "ride", line: "inja", board: { place: "bus_stop:a" }, alight: { place: "bus_stop:b" }, rideMinutes: 30, evidence: "x" },
        { kind: "walk", from: "bus_stop:b", to: "bus_stop:c", minutes: 2, distanceM: 150, evidence: "TMAP" },
        { kind: "ride", line: "inja", board: { place: "bus_stop:c" }, alight: { place: "bus_stop:d" }, rideMinutes: 20, evidence: "x" },
      ],
    };
    const at = (clock: string) => new Date(`2026-10-20T${clock}+09:00`);
    const plusSec = (clock: string, sec: number) => new Date(at(clock).getTime() + sec * 1000);
    const timetabled = board([departure("14:10", call(at("14:40:00"), { scheduledDepartureAt: null, scheduledArrivalAt: at("14:40:00") }))]);
    const secondRide = (boardAt: Date, extra: Partial<StopCall> = {}) => board([{ lineId: "campus-inja", board: call(boardAt, extra), alight: null, observedAt: null }]);
    const plan = (first: DepartureBoard, second: DepartureBoard) => planOption(TWO_RIDES, { now: kst("14:00"), catchMarginSec: 60, lineById: new Map([["inja", LINE]]), boards: new Map([[1, first], [3, second]]) });
    const warningsOf = (planned: PlannedOption) => running(planned).warnings;

    it.each([
      [119, [{ code: "tightTransfer", legIndex: 3 }]],
      [120, []],
      [121, []],
    ])("Tight transfer: %i s between reaching the stop and the next timetabled ride", (slackSec, warnings) => {
      // Act
      const planned = plan(timetabled, secondRide(plusSec("14:42:00", slackSec)));

      // Assert
      expect(warningsOf(planned)).toEqual(warnings);
    });

    it.each([
      [149, [{ code: "connectionAtRisk", legIndex: 3 }]],
      [150, []],
    ])("At risk: %i s after a ride whose arrival is estimated from its ride minutes", (slackSec, warnings) => {
      // Arrange
      const estimatedArrival = board([departure("14:10")]);

      // Act
      const planned = plan(estimatedArrival, secondRide(plusSec("14:42:00", slackSec)));

      // Assert
      expect(warningsOf(planned)).toEqual(warnings);
    });

    it.each([
      [449, [{ code: "connectionAtRisk", legIndex: 3 }]],
      [450, []],
    ])("At risk: %i s after a ride boarded half a 10-minute headway after the rider is ready", (slackSec, warnings) => {
      // Arrange
      const headway = board([], { continuation: { kind: "headway", headwaySec: 600, serviceEndsAt: kst("23:00") } });

      // Act
      const planned = plan(headway, secondRide(plusSec("14:43:00", slackSec)));

      // Assert
      expect(rideOf(planned).board.expectedArrivalAt).toEqual(at("14:11:00"));
      expect(warningsOf(planned)).toEqual(warnings);
    });

    it.each([
      ["an estimate of a named run", { basis: "estimate", runId: "run-1" }, 149, [{ code: "connectionAtRisk", legIndex: 3 }]],
      ["an estimate of a named run", { basis: "estimate", runId: "run-1" }, 150, []],
      ["a headway estimate, which names no run to miss", { basis: "estimate", runId: null, vehicleId: null }, 149, []],
    ] as const)("At risk: boarding %s %i s after reaching the stop", (_case, extra, slackSec, warnings) => {
      // Act
      const planned = plan(timetabled, secondRide(plusSec("14:42:00", slackSec), extra));

      // Assert
      expect(warningsOf(planned)).toEqual(warnings);
    });

    it("warns of no first ride, which no ride before it can make the rider miss", () => {
      // Act
      const planned = planOption(OPTION, context(kst("14:00"), board([departure("14:08", null, { basis: "estimate" })])));

      // Assert
      expect([rideOf(planned).waitSec, running(planned).warnings]).toEqual([60, []]);
    });
  });
});

describe("planOption: a ride's upcoming calls at its board stop, counted from now", () => {
  const at = (clock: string) => new Date(`2026-10-20T${clock}+09:00`);
  const seats = (id: string, seatsLeft: number | null) => ({ id, occupancy: null, seatsLeft, isLowFloor: null });
  const HEADWAY = { kind: "headway", headwaySec: 600, serviceEndsAt: kst("23:00") } as const;
  const upcomingOf = (planned: PlannedOption) => rideOf(planned).upcoming.map((upcoming) => toBoardTime(upcoming));

  it("lists a later ride's next calls from now, before the call the connection boards", () => {
    // Arrange
    const twoRides: JourneyOption = {
      ...OPTION,
      legs: [
        { kind: "walk", from: "skku_building:1", to: "bus_stop:a", minutes: 5, distanceM: 400, evidence: "TMAP" },
        { kind: "ride", line: "inja", board: { place: "bus_stop:a" }, alight: { place: "bus_stop:b" }, rideMinutes: 30, evidence: "x" },
        { kind: "ride", line: "inja", board: { place: "bus_stop:b" }, alight: { place: "bus_stop:c" }, rideMinutes: 20, evidence: "x" },
      ],
    };
    const first = board([departure("14:10", call(kst("14:40"), { scheduledDepartureAt: null, scheduledArrivalAt: kst("14:40") }))]);
    const second = board([departure("14:05"), departure("14:20"), departure("14:50"), departure("15:20")]);

    // Act
    const planned = planOption(twoRides, { now: kst("14:00"), catchMarginSec: 60, lineById: new Map([["inja", LINE]]), boards: new Map([[1, first], [2, second]]) });

    // Assert
    const secondRide = running(planned).legs[2] as PlannedRide;
    expect(secondRide.board.scheduledDepartureAt).toEqual(kst("14:50"));
    expect(secondRide.upcoming.map((upcoming) => upcoming.scheduledDepartureAt)).toEqual([kst("14:05"), kst("14:20")]);
  });

  it.each([
    ["one second before now", "13:59:59", ["14:00:00", "14:00:01"]],
    ["at now", "14:00:00", ["14:00:00", "14:00:01"]],
    ["one second after now", "14:00:01", ["14:00:01", "14:00:02"]],
  ])("counts a call boarding %s, at most two, with no catch margin", (_case, firstAt, expected) => {
    // Arrange
    const times = [...new Set([firstAt, "14:00:00", "14:00:01", "14:00:02", "14:30:00"])].filter((time) => time >= firstAt);
    const runs = board(times.map((time) => ({ lineId: "campus-inja", board: call(at(time)), alight: null, observedAt: null })));

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(upcomingOf(planned)).toEqual(expected.map(at));
  });

  it("leaves out a call that has left before now", () => {
    // Arrange
    const runs = board([{ lineId: "campus-inja", board: call(at("13:59:59")), alight: null, observedAt: null }, departure("14:30")]);

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(upcomingOf(planned)).toEqual([kst("14:30")]);
  });

  it("skips a vehicle with no seat left, counts unknown seats, and serves each upcoming vehicle once", () => {
    // Arrange
    const vehicles = { full: seats("full", 0), unknown: seats("unknown", null), seated: seats("seated", 4) };
    const runs = board([["full", "14:01"], ["unknown", "14:02"], ["seated", "14:10"]].map(([id, time]) => departure(time!, null, { vehicleId: id!, basis: "provider" })), { vehicles });

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).upcoming.map((upcoming) => upcoming.vehicleId)).toEqual(["unknown", "seated"]);
    expect(rideOf(planned).board.vehicleId).toBe("seated");
    expect(rideOf(planned).vehicles.map((vehicle) => vehicle.id)).toEqual(["seated", "unknown"]);
  });

  it.each([
    ["a board with only a headway past the listed vehicles", board([], { continuation: HEADWAY })],
    ["a board with nothing listed from now", board([departure("13:30")], { continuation: HEADWAY })],
  ])("is empty for %s, naming no headway estimate", (_case, runs) => {
    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect([rideOf(planned).board.basis, rideOf(planned).upcoming]).toEqual(["estimate", []]);
  });
});

describe("planOption: a ride's stops between its board and alight stops", () => {
  const PASSED = { kind: "bus_stop", id: "yangjae-exit2", name: "양재역 2번 출구", coords: { lat: 37.485406, lng: 127.033382 }, platformId: null, action: null } as const;

  it.each([
    ["the stops the door lists", [PASSED], [PASSED]],
    ["none listed when the door lists none between", [], []],
    ["null when the door cannot list them", undefined, null],
  ])("are %s", (_case, stops, expected) => {
    // Arrange
    const runs = board([departure("14:30")], stops === undefined ? {} : { stops });

    // Act
    const planned = planOption(OPTION, context(kst("14:00"), runs));

    // Assert
    expect(rideOf(planned).stops).toEqual(expected);
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
  const runningAt = (arriveAt: string): PlannedOption => ({ status: "running", leaveAt: kst("14:00"), arriveAt: kst(arriveAt), legs: [], warnings: [] });
  const ended: PlannedOption = { status: "notRunning", reason: "ended", nextServiceAt: null };

  it("runs options by arrival, data order breaking a tie, then the ones not running in data order", () => {
    // Act
    const order = toOptionOrder([ended, runningAt("15:56"), runningAt("15:10"), { ...ended, reason: "unavailable" }, runningAt("15:10")]);

    // Assert
    expect(order).toEqual([2, 4, 1, 0, 3]);
  });
});
