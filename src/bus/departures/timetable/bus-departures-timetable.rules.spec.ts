/**
 * What the timetabled-shuttle door decides (ADR 0022, D6; docs/plans/transit-route-planner.md "Producers"): where a
 * service's sequence places a leg's board and alight stops for each route type, with the alight after the board; the
 * departures of every route type that calls at both, joined by run, a board call and an alight call of the same run
 * filled as the stop page fills them (toTimetabledCall), listed from the current minute to the window's end by board
 * time; a run's first and last flags taken across every route type on its day, so a hakbu run after the last
 * regular one is the day's last; a run with no time at the board left out, and an alight with none answered as null;
 * and the first departure after the window as the next service; the stops a leg passes between its two, listed only
 * when every route type serving it calls at the same ones, each a catalog stop (2026-10-26).
 */
import type { SequenceStop } from "../../stops/bus-stops.types";
import type { RunStopTime, ShuttleRun } from "../../eta/smart/bus-eta-smart.types";
import { toKstDayStart, toLegStopIds, toLegStops, toTimetableBoard } from "./bus-departures-timetable.rules";

const kst = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);
const timetable = (at: Date | null): RunStopTime => ({ shownAt: at, isEstimated: false, latestEstimateAt: null, timetableAt: at });
const estimated = (at: Date): RunStopTime => ({ shownAt: at, isEstimated: true, latestEstimateAt: at, timetableAt: null });

function run(date: string, time: string, routeType = "regular", dropOff: RunStopTime = timetable(null), extra: Partial<ShuttleRun> = {}): ShuttleRun {
  return {
    runId: `campus-inja|${routeType}|${date}|${time}`,
    routeType,
    date,
    departureAt: kst(date, time),
    isFirstOfDay: false,
    isLastOfDay: false,
    stopTimes: [timetable(kst(date, time)), dropOff],
    estimate: null,
    ...extra,
  };
}

const stop = (stopId: string, action: SequenceStop["action"]): SequenceStop => ({ stopId, action, timing: action === "board" ? "scheduled" : "estimated" });
const SEQUENCES = {
  regular: [stop("hssc-bus-lot", "board"), stop("nsc-n-center", "alight")],
  hakbu: [stop("hssc-bus-lot", "board"), stop("nsc-n-center", "alight")],
};
const LEG = toLegStops(SEQUENCES, "hssc-bus-lot", "nsc-n-center");
const HEADSIGN = "인사캠 → 자과캠";
const AT_14_10_KST = kst("2026-10-20", "14:10");
const query = (from: Date, hours = 3) => ({ lineId: "campus-inja", boardStopId: "hssc-bus-lot", alightStopId: "nsc-n-center", from, until: new Date(from.getTime() + hours * 3_600_000), lang: "ko" as const });

describe("toLegStops", () => {
  it("places the board stop and the alight stop after it for every route type that calls at both", () => {
    // Act & Assert
    expect([...LEG]).toEqual([
      ["regular", { board: { index: 0, action: "board" }, alight: { index: 1, action: "alight" } }],
      ["hakbu", { board: { index: 0, action: "board" }, alight: { index: 1, action: "alight" } }],
    ]);
  });

  it("Reversed pair: places nothing when the alight stop comes before the board stop", () => {
    // Act & Assert
    expect(toLegStops(SEQUENCES, "nsc-n-center", "hssc-bus-lot").size).toBe(0);
  });

  it("places nothing for a service with no sequence, and only the board with no alight stop asked for", () => {
    // Act & Assert
    expect(toLegStops(undefined, "hssc-bus-lot", "nsc-n-center").size).toBe(0);
    expect(toLegStops(SEQUENCES, "hssc-bus-lot", null).get("regular")).toEqual({ board: { index: 0, action: "board" }, alight: null });
  });
});

describe("toLegStopIds", () => {
  const between = (...stopIds: string[]) => ({ up: [stop("gangnam-exit5", "board"), ...stopIds.map((stopId) => stop(stopId, "board")), stop("nsc-n-center", "alight")] });

  it.each([
    ["the stops between, in travel order", between("yangjae-exit2", "pangyo"), ["yangjae-exit2", "pangyo"]],
    ["none when the alight stop follows the board stop", between(), []],
  ])("lists %s", (_case, sequences, expected) => {
    // Act & Assert
    expect(toLegStopIds(sequences, toLegStops(sequences, "gangnam-exit5", "nsc-n-center"))).toEqual(expected);
  });

  it("lists them when every route type serving the leg calls at the same ones", () => {
    // Arrange
    const sequences = { ...between("yangjae-exit2"), express: between("yangjae-exit2").up };

    // Act & Assert
    expect(toLegStopIds(sequences, toLegStops(sequences, "gangnam-exit5", "nsc-n-center"))).toEqual(["yangjae-exit2"]);
  });

  it.each([
    ["route types serving the leg call at different stops between", { ...between("yangjae-exit2"), express: between().up }],
    ["a stop between names no catalog stop", { up: [stop("gangnam-exit5", "board"), { action: "board" as const, timing: "scheduled" as const }, stop("nsc-n-center", "alight")] }],
  ])("lists none when %s", (_case, sequences) => {
    // Act & Assert
    expect(toLegStopIds(sequences, toLegStops(sequences, "gangnam-exit5", "nsc-n-center"))).toBeNull();
  });

  it("lists none for a leg asked with no alight stop", () => {
    // Act & Assert
    expect(toLegStopIds(between("yangjae-exit2"), toLegStops(between("yangjae-exit2"), "gangnam-exit5", null))).toBeNull();
  });
});

describe("toTimetableBoard", () => {
  it("joins each run's board and alight calls by run, from the current minute, by board time", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:30", "regular", estimated(kst("2026-10-20", "15:42"))), run("2026-10-20", "14:00"), run("2026-10-20", "14:10", "hakbu")];

    // Act
    const board = toTimetableBoard(runs, query(AT_14_10_KST), { legStops: LEG, headsign: HEADSIGN });

    // Assert
    expect(board.departures.map((departure) => [departure.board.runId, departure.alight?.runId ?? null])).toEqual([
      ["campus-inja|hakbu|2026-10-20|14:10", null],
      ["campus-inja|regular|2026-10-20|14:30", "campus-inja|regular|2026-10-20|14:30"],
    ]);
    const [, joined] = board.departures;
    expect(joined?.board).toMatchObject({ scheduledDepartureAt: kst("2026-10-20", "14:30"), basis: "timetable", headsign: HEADSIGN });
    expect(joined?.alight).toMatchObject({ expectedArrivalAt: kst("2026-10-20", "15:42"), basis: "estimate", headsign: HEADSIGN });
    expect(board.continuation).toEqual({ kind: "listed" });
    expect(board.vehicles).toEqual({});
  });

  it.each([
    ["one minute before the window's end", "17:09", 1],
    ["at the window's end", "17:10", 1],
    ["one minute after it", "17:11", 0],
  ])("lists a run %s", (_case, time, count) => {
    // Arrange
    const runs = [run("2026-10-20", time)];

    // Act
    const board = toTimetableBoard(runs, query(AT_14_10_KST), { legStops: LEG, headsign: HEADSIGN });

    // Assert
    expect(board.departures).toHaveLength(count);
  });

  it("takes the first and last flags across every route type of the day, so a hakbu run after the last regular is the day's last", () => {
    // Arrange
    const runs = [run("2026-10-20", "08:00", "hakbu"), run("2026-10-20", "14:30"), run("2026-10-20", "15:00"), run("2026-10-20", "15:30", "hakbu")];

    // Act
    const board = toTimetableBoard(runs, query(AT_14_10_KST), { legStops: LEG, headsign: HEADSIGN });

    // Assert
    expect(board.departures.map(({ board: call }) => [call.runId, call.isFirstRun, call.isLastRun])).toEqual([
      ["campus-inja|regular|2026-10-20|14:30", false, false],
      ["campus-inja|regular|2026-10-20|15:00", false, false],
      ["campus-inja|hakbu|2026-10-20|15:30", false, true],
    ]);
  });

  it("leaves out a run with no time at the board stop", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:30", "regular", timetable(null), { stopTimes: [timetable(null), timetable(null)] })];

    // Act
    const board = toTimetableBoard(runs, query(AT_14_10_KST), { legStops: LEG, headsign: HEADSIGN });

    // Assert
    expect(board.departures).toEqual([]);
  });

  it("Day ended: lists none and names the next day's first departure as the next service", () => {
    // Arrange
    const runs = [run("2026-10-20", "17:00"), run("2026-10-21", "08:00"), run("2026-10-21", "09:00")];

    // Act
    const board = toTimetableBoard(runs, query(kst("2026-10-20", "20:00")), { legStops: LEG, headsign: HEADSIGN });

    // Assert
    expect(board.departures).toEqual([]);
    expect(board.nextServiceAt).toEqual(kst("2026-10-21", "08:00"));
  });

  it("names no next service when no run follows the window", () => {
    // Act
    const board = toTimetableBoard([run("2026-10-20", "14:30")], query(AT_14_10_KST), { legStops: LEG, headsign: HEADSIGN });

    // Assert
    expect(board.nextServiceAt).toBeNull();
  });
});

describe("toKstDayStart", () => {
  it("is midnight in Asia/Seoul, where the UTC date is still the day before", () => {
    // Act
    const start = toKstDayStart(new Date("2026-10-19T16:30:00.000Z"));

    // Assert
    expect(start.toISOString()).toBe("2026-10-19T15:00:00.000Z");
    expect(start.toISOString()).not.toBe("2026-10-19T00:00:00.000Z");
  });
});
