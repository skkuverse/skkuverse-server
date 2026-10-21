/**
 * What a stop page decides (unify-bus-stops design D8 and D9; spec bus-stop-arrivals): how many of the HSSC loop's
 * 11 positions each bus is from the stop, counted forward round the loop, nearest first, and a shuttle stop's next three runs in Asia/Seoul: a run counts
 * while its time at the stop, or its departure when that is unknown, is not before the current minute; a stop time
 * before the departure is the next day's; `estimated` follows the smart view's `eta` at an estimated stop; and no run
 * is listed unless the smart schedule is active.
 */
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import { toApproaching, toNextRuns } from "./bus-stop-arrivals.rules";

describe("toApproaching", () => {
  it.each([
    [[1, 4], 6, [{ stopsAway: 2 }, { stopsAway: 5 }]],
    [[8], 6, [{ stopsAway: 9 }]],
    [[7, 6, 5], 6, [{ stopsAway: 0 }, { stopsAway: 1 }, { stopsAway: 10 }]],
    [[], 6, []],
    [[0, 3, 0], 3, [{ stopsAway: 0 }, { stopsAway: 3 }, { stopsAway: 3 }]],
    // WHY: the 600th Anniversary Hall (10) runs on to the basketball court (0), the loop's first position, which is 10 positions short of the hall.
    [[10], 0, [{ stopsAway: 1 }]],
    [[0], 10, [{ stopsAway: 10 }]],
    [[10, 9], 10, [{ stopsAway: 0 }, { stopsAway: 1 }]],
  ])("buses at %j, stop at %d → %j", (indexes, stationIndex, expected) => {
    // Arrange
    const buses = indexes.map((index) => ({ stationIndex: index }));

    // Act & Assert
    expect(toApproaching(buses, stationIndex)).toEqual(expected);
  });
});

type Entry = SmartSchedule["days"][number]["schedule"][number];
const entry = (time: string, stopTimes: Array<string | null>, extra: Partial<Entry> = {}): Entry => ({ time, routeType: "regular", stopTimes, ...extra });
const day = (date: string, schedule: Entry[]) => ({ date, dayOfWeek: 2, display: "visible", notices: [], schedule });
const schedule = (days: SmartSchedule["days"], status: SmartSchedule["status"] = "active"): SmartSchedule => ({ serviceId: "campus-inja", status, from: "2026-10-19", selectedDate: "2026-10-20", days });
const BOARD = { routeType: "regular", sequenceIndex: 0, timing: "scheduled" as const };
const ALIGHT = { routeType: "regular", sequenceIndex: 1, timing: "estimated" as const };
const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");

describe("toNextRuns", () => {
  it("lists the next three runs at 14:10 KST, and not the one that left at 14:00", () => {
    // Arrange
    const runs = ["14:00", "14:30", "15:00", "15:30"].map((time) => entry(time, [time, null]));

    // Act
    const next = toNextRuns(schedule([day("2026-10-20", runs)]), BOARD, AT_14_10_KST);

    // Assert
    expect(next.map((run) => run.departure)).toEqual(["14:30", "15:00", "15:30"]);
    expect(next[0]).toEqual({ date: "2026-10-20", departure: "14:30", time: "14:30", estimated: false });
  });

  it.each([
    ["2026-10-20T05:09:00.000Z", ["14:10", "14:20"]],
    ["2026-10-20T05:10:59.000Z", ["14:10", "14:20"]],
    ["2026-10-20T05:11:00.000Z", ["14:20"]],
  ])("counts a run at its own minute: at %s the runs are %j", (now, departures) => {
    // Arrange
    const runs = ["14:10", "14:20"].map((time) => entry(time, [time, null]));

    // Act
    const next = toNextRuns(schedule([day("2026-10-20", runs)]), BOARD, new Date(now));

    // Assert
    expect(next.map((run) => run.departure)).toEqual(departures);
  });

  it("reads today in Asia/Seoul: at 01:30 KST on the 20th (UTC the 19th) a 17:00 run of the 19th is gone", () => {
    // Arrange
    const days = [day("2026-10-19", [entry("17:00", ["17:00", null])]), day("2026-10-20", [entry("14:00", ["14:00", null])])];

    // Act
    const next = toNextRuns(schedule(days), BOARD, new Date("2026-10-19T16:30:00.000Z"));

    // Assert
    expect(next).toEqual([{ date: "2026-10-20", departure: "14:00", time: "14:00", estimated: false }]);
  });

  it("orders a run with no time at the stop by its departure, and marks an estimated time", () => {
    // Arrange
    const runs = [entry("14:30", ["14:30", "15:20"], { eta: { source: "live", updatedAt: "2026-10-20T05:05:00.000Z" } }), entry("15:00", ["15:00", null]), entry("15:30", ["15:30", null])];

    // Act
    const next = toNextRuns(schedule([day("2026-10-20", runs)]), ALIGHT, AT_14_10_KST);

    // Assert
    expect(next).toEqual([
      { date: "2026-10-20", departure: "15:00", time: null, estimated: false },
      { date: "2026-10-20", departure: "14:30", time: "15:20", estimated: true },
      { date: "2026-10-20", departure: "15:30", time: null, estimated: false },
    ]);
  });

  it("marks a stored time at an estimated stop with no estimate as not estimated", () => {
    // Arrange
    const runs = [entry("14:30", ["14:30", "15:20"])];

    // Act & Assert
    expect(toNextRuns(schedule([day("2026-10-20", runs)]), ALIGHT, AT_14_10_KST)).toEqual([{ date: "2026-10-20", departure: "14:30", time: "15:20", estimated: false }]);
  });

  it("marks a time at a scheduled stop as not estimated, even on an estimated run", () => {
    // Arrange
    const runs = [entry("14:30", ["14:30", "15:20"], { eta: { source: "live", updatedAt: "2026-10-20T05:05:00.000Z" } })];

    // Act & Assert
    expect(toNextRuns(schedule([day("2026-10-20", runs)]), BOARD, AT_14_10_KST)[0]?.estimated).toBe(false);
  });

  it("reads a stop time before the departure as the next day's", () => {
    // Arrange
    const runs = [entry("23:50", ["23:50", "00:20"])];

    // Act
    const next = toNextRuns(schedule([day("2026-10-20", runs)]), ALIGHT, new Date("2026-10-20T15:05:00.000Z"));

    // Assert
    expect(next).toEqual([{ date: "2026-10-20", departure: "23:50", time: "00:20", estimated: false }]);
  });

  it("lists the next day's runs once today's are gone, and only the stop's route type", () => {
    // Arrange
    const days = [
      day("2026-10-20", [entry("14:00", ["14:00", null]), entry("14:20", ["14:20", null], { routeType: "hakbu" })]),
      day("2026-10-21", [entry("09:00", ["09:00", null]), entry("10:00", ["10:00", null])]),
      day("2026-10-22", [entry("09:00", ["09:00", null]), entry("10:00", ["10:00", null])]),
    ];

    // Act
    const next = toNextRuns(schedule(days), BOARD, AT_14_10_KST);

    // Assert
    expect(next.map((run) => `${run.date} ${run.departure}`)).toEqual(["2026-10-21 09:00", "2026-10-21 10:00", "2026-10-22 09:00"]);
  });

  it("reads an entry without stop times by its departure", () => {
    // Arrange
    const runs = [{ time: "14:30", routeType: "regular" }];

    // Act & Assert
    expect(toNextRuns(schedule([day("2026-10-20", runs)]), ALIGHT, AT_14_10_KST)).toEqual([{ date: "2026-10-20", departure: "14:30", time: null, estimated: false }]);
  });

  it.each(["suspended", "noData"] as const)("lists no run while the schedule is %s", (status) => {
    // Arrange
    const runs = [entry("14:30", ["14:30", null])];

    // Act & Assert
    expect(toNextRuns(schedule([day("2026-10-20", runs)], status), BOARD, AT_14_10_KST)).toEqual([]);
  });
});
