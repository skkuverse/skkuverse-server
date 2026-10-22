/**
 * What a stop page decides (ADR 0019, D12): a shuttle stop's next three runs in Asia/Seoul as scheduled arrivals:
 * a run is listed while its time at the stop (the estimate at an estimated stop, else the timetable's), or its
 * departure when no time is known there, is not before the current minute; a stop time before the departure is the
 * next day's; a boarding stop fills the departure pair and an alighting stop the arrival pair, the estimate's when
 * the smart view applied one; each run keeps its departure, and the day's last run of its route type is the last
 * bus; no run is listed unless the smart schedule is active. And the HSSC line's next station with a stop, which
 * tells a rider the direction, round the loop.
 */
import type { SmartSchedule } from "../schedule/bus-schedule.wire";
import { toTimetableArrivals, toTowards } from "./bus-stop-arrivals.rules";

type Entry = SmartSchedule["days"][number]["schedule"][number];
const entry = (time: string, stopTimes: Array<string | null>, extra: Partial<Entry> = {}): Entry => ({ time, routeType: "regular", stopTimes, ...extra });
const day = (date: string, schedule: Entry[]) => ({ date, dayOfWeek: 2, display: "visible", notices: [], schedule });
const schedule = (days: SmartSchedule["days"], status: SmartSchedule["status"] = "active"): SmartSchedule => ({ serviceId: "campus-inja", status, from: "2026-10-19", selectedDate: "2026-10-20", days });
const BOARD = { routeType: "regular", sequenceIndex: 0, timing: "scheduled" as const, action: "board" as const };
const ALIGHT = { routeType: "regular", sequenceIndex: 1, timing: "estimated" as const, action: "alight" as const };
const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
const LIVE_ETA = { eta: { source: "live", updatedAt: "2026-10-20T05:05:00.000Z" } };
const departuresOf = (arrivals: ReturnType<typeof toTimetableArrivals>) => arrivals.map((arrival) => arrival.runDepartureAt);

describe("toTimetableArrivals", () => {
  it("lists the next three runs at 14:10 KST as scheduled departures, and not the one that left at 14:00", () => {
    // Arrange
    const runs = ["14:00", "14:30", "15:00", "15:30"].map((time) => entry(time, [time, null]));

    // Act
    const arrivals = toTimetableArrivals(schedule([day("2026-10-20", runs)]), BOARD, AT_14_10_KST);

    // Assert
    expect(departuresOf(arrivals)).toEqual(["2026-10-20T14:30:00+09:00", "2026-10-20T15:00:00+09:00", "2026-10-20T15:30:00+09:00"]);
    expect(arrivals[0]).toEqual({
      status: "scheduled",
      expectedArrivalAt: null,
      expectedDepartureAt: null,
      scheduledArrivalAt: null,
      scheduledDepartureAt: "2026-10-20T14:30:00+09:00",
      basis: "timetable",
      stopsAway: null,
      isLastBus: false,
      vehicleId: null,
      providerText: null,
      runDepartureAt: "2026-10-20T14:30:00+09:00",
    });
    expect(arrivals.map((arrival) => arrival.isLastBus)).toEqual([false, false, true]);
  });

  it.each([
    ["2026-10-20T05:09:00.000Z", ["14:10", "14:20"]],
    ["2026-10-20T05:10:59.000Z", ["14:10", "14:20"]],
    ["2026-10-20T05:11:00.000Z", ["14:20"]],
  ])("counts a run at its own minute: at %s the runs are %j", (now, departures) => {
    // Arrange
    const runs = ["14:10", "14:20"].map((time) => entry(time, [time, null]));

    // Act
    const arrivals = toTimetableArrivals(schedule([day("2026-10-20", runs)]), BOARD, new Date(now));

    // Assert
    expect(departuresOf(arrivals)).toEqual(departures.map((time) => `2026-10-20T${time}:00+09:00`));
  });

  it("reads today in Asia/Seoul: at 01:30 KST on the 20th (UTC the 19th) a 17:00 run of the 19th is gone", () => {
    // Arrange
    const days = [day("2026-10-19", [entry("17:00", ["17:00", null])]), day("2026-10-20", [entry("14:00", ["14:00", null])])];

    // Act
    const arrivals = toTimetableArrivals(schedule(days), BOARD, new Date("2026-10-19T16:30:00.000Z"));

    // Assert
    expect(departuresOf(arrivals)).toEqual(["2026-10-20T14:00:00+09:00"]);
  });

  it("serves an estimated drop-off as the expected arrival, and lists that run until it arrives, after its departure", () => {
    // Arrange
    const runs = [entry("14:00", ["14:00", "15:10"], LIVE_ETA), entry("14:30", ["14:30", null])];

    // Act
    const arrivals = toTimetableArrivals(schedule([day("2026-10-20", runs)]), ALIGHT, new Date("2026-10-20T05:40:00.000Z"));

    // Assert
    expect(arrivals).toEqual([
      expect.objectContaining({ runDepartureAt: "2026-10-20T14:00:00+09:00", expectedArrivalAt: "2026-10-20T15:10:00+09:00", scheduledArrivalAt: null, basis: "estimate" }),
    ]);
  });

  it("orders a run with no time at the stop by its departure", () => {
    // Arrange
    const runs = [entry("14:30", ["14:30", "15:20"], LIVE_ETA), entry("15:00", ["15:00", null]), entry("15:30", ["15:30", null])];

    // Act
    const arrivals = toTimetableArrivals(schedule([day("2026-10-20", runs)]), ALIGHT, AT_14_10_KST);

    // Assert
    expect(arrivals.map(({ runDepartureAt, expectedArrivalAt, scheduledArrivalAt }) => [runDepartureAt, expectedArrivalAt, scheduledArrivalAt])).toEqual([
      ["2026-10-20T15:00:00+09:00", null, null],
      ["2026-10-20T14:30:00+09:00", "2026-10-20T15:20:00+09:00", null],
      ["2026-10-20T15:30:00+09:00", null, null],
    ]);
  });

  it("serves a stored time at an estimated stop with no estimate as the timetable's", () => {
    // Arrange
    const runs = [entry("14:30", ["14:30", "15:20"])];

    // Act & Assert
    expect(toTimetableArrivals(schedule([day("2026-10-20", runs)]), ALIGHT, AT_14_10_KST)).toEqual([
      expect.objectContaining({ expectedArrivalAt: null, scheduledArrivalAt: "2026-10-20T15:20:00+09:00", basis: "timetable" }),
    ]);
  });

  it("serves a time at a scheduled stop as the timetable's, even on an estimated run", () => {
    // Arrange
    const runs = [entry("14:30", ["14:30", "15:20"], LIVE_ETA)];

    // Act & Assert
    expect(toTimetableArrivals(schedule([day("2026-10-20", runs)]), BOARD, AT_14_10_KST)[0]).toMatchObject({ scheduledDepartureAt: "2026-10-20T14:30:00+09:00", expectedDepartureAt: null, basis: "timetable" });
  });

  it("reads a stop time before the departure as the next day's", () => {
    // Arrange
    const runs = [entry("23:50", ["23:50", "00:20"])];

    // Act
    const arrivals = toTimetableArrivals(schedule([day("2026-10-20", runs)]), ALIGHT, new Date("2026-10-20T15:05:00.000Z"));

    // Assert
    expect(arrivals).toEqual([expect.objectContaining({ runDepartureAt: "2026-10-20T23:50:00+09:00", scheduledArrivalAt: "2026-10-21T00:20:00+09:00" })]);
  });

  it("lists the next day's runs once today's are gone, and only the stop's route type, each day's last run the last bus", () => {
    // Arrange
    const days = [
      day("2026-10-20", [entry("14:00", ["14:00", null]), entry("14:20", ["14:20", null], { routeType: "hakbu" })]),
      day("2026-10-21", [entry("09:00", ["09:00", null]), entry("10:00", ["10:00", null])]),
      day("2026-10-22", [entry("09:00", ["09:00", null]), entry("10:00", ["10:00", null])]),
    ];

    // Act
    const arrivals = toTimetableArrivals(schedule(days), BOARD, AT_14_10_KST);

    // Assert
    expect(arrivals.map(({ runDepartureAt, isLastBus }) => [runDepartureAt, isLastBus])).toEqual([
      ["2026-10-21T09:00:00+09:00", false],
      ["2026-10-21T10:00:00+09:00", true],
      ["2026-10-22T09:00:00+09:00", false],
    ]);
  });

  it("reads an entry without stop times by its departure", () => {
    // Arrange
    const runs = [{ time: "14:30", routeType: "regular" }];

    // Act & Assert
    expect(toTimetableArrivals(schedule([day("2026-10-20", runs)]), ALIGHT, AT_14_10_KST)).toEqual([
      expect.objectContaining({ runDepartureAt: "2026-10-20T14:30:00+09:00", scheduledArrivalAt: null, expectedArrivalAt: null }),
    ]);
  });

  it.each(["suspended", "noData"] as const)("lists no run while the smart schedule is %s", (status) => {
    // Act & Assert
    expect(toTimetableArrivals(schedule([day("2026-10-20", [entry("14:30", ["14:30", null])])], status), BOARD, AT_14_10_KST)).toEqual([]);
  });
});

describe("toTowards", () => {
  const station = (name: string, stopId: string | null) => ({ name, stopId });
  const line = [station("농구장", "a"), station("600주년(하교)", "b"), station("혜화동로터리", null), station("혜화역", "c")];

  it.each([
    [0, "600주년(하교)"],
    [1, "혜화역"],
    [3, "농구장"],
  ])("station %i heads towards %s, the next with a stop round the loop", (stationIndex, expected) => {
    // Act & Assert
    expect(toTowards(line, stationIndex)).toBe(expected);
  });

  it("answers null on a line with no other stop", () => {
    // Act & Assert
    expect(toTowards([station("농구장", "a"), station("로터리", null)], 0)).toBeNull();
  });
});
