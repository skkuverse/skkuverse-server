/**
 * What a stop page decides (ADR 0019, D12): a shuttle stop's next three runs as scheduled arrivals, from the run read's
 * instants (review F1): a run of the stop's route type is listed while its time at the stop (the estimate at an
 * estimated stop, else the timetable's), or its departure when no time is known there, is not before the current
 * minute in Asia/Seoul; a boarding stop fills the departure pair and an alighting stop the arrival pair, the
 * estimate's when the run read served one there; each run keeps its departure, and the run read's last run of the day
 * is the last bus. Where the stop shows no timetable time, a run is listed until the later of its latest estimate's
 * arrival (the newest fetched, served or not) and the served estimate it shows, else by its departure, while the page
 * shows only the served estimate. How a stop time past midnight is read is the run read's (toStopAt in
 * src/bus/eta/smart/bus-eta-smart.rules.spec.ts); the HSSC line's next station with a stop moved with toTowards to
 * src/bus/bus.rules.spec.ts, since GET /bus/stops heads its stations the same way.
 */
import type { RunStopTime, ShuttleRun } from "../eta/smart/bus-eta-smart.types";
import { toTimetableArrivals } from "./bus-stop-arrivals.rules";

const kst = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);
const timetable = (at: Date | null): RunStopTime => ({ shownAt: at, isEstimated: false, latestEstimateAt: null });
const estimated = (at: Date, latestEstimateAt: Date | null = at): RunStopTime => ({ shownAt: at, isEstimated: true, latestEstimateAt });

/** A campus-inja regular run on a date: boarding at its departure, then the drop-off as given (none by default). */
function run(date: string, time: string, extra: Partial<ShuttleRun> & { dropOff?: RunStopTime } = {}): ShuttleRun {
  const { dropOff = timetable(null), ...fields } = extra;
  return {
    runId: `campus-inja|regular|${date}|${time}`,
    routeType: "regular",
    date,
    departureAt: kst(date, time),
    isLastOfDay: false,
    stopTimes: [timetable(kst(date, time)), dropOff],
    estimate: null,
    ...fields,
  };
}

const BOARD = { routeType: "regular", sequenceIndex: 0, action: "board" as const };
const ALIGHT = { routeType: "regular", sequenceIndex: 1, action: "alight" as const };
const AT_14_10_KST = new Date("2026-10-20T05:10:00.000Z");
const departuresOf = (arrivals: ReturnType<typeof toTimetableArrivals>) => arrivals.map((arrival) => arrival.runDepartureAt);

describe("toTimetableArrivals", () => {
  it("lists the next three runs at 14:10 KST as scheduled departures, and not the one that left at 14:00", () => {
    // Arrange
    const runs = ["14:00", "14:30", "15:00", "15:30"].map((time) => run("2026-10-20", time, { isLastOfDay: time === "15:30" }));

    // Act
    const arrivals = toTimetableArrivals(runs, BOARD, AT_14_10_KST);

    // Assert
    expect(departuresOf(arrivals)).toEqual(["2026-10-20T14:30:00+09:00", "2026-10-20T15:00:00+09:00", "2026-10-20T15:30:00+09:00"]);
    expect(JSON.stringify(arrivals[0])).toBe(
      JSON.stringify({
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
      }),
    );
    expect(arrivals.map((arrival) => arrival.isLastBus)).toEqual([false, false, true]);
  });

  it.each([
    ["2026-10-20T05:09:00.000Z", ["14:10", "14:20"]],
    ["2026-10-20T05:10:59.000Z", ["14:10", "14:20"]],
    ["2026-10-20T05:11:00.000Z", ["14:20"]],
  ])("counts a run at its own minute: at %s the runs are %j", (now, departures) => {
    // Arrange
    const runs = ["14:10", "14:20"].map((time) => run("2026-10-20", time));

    // Act
    const arrivals = toTimetableArrivals(runs, BOARD, new Date(now));

    // Assert
    expect(departuresOf(arrivals)).toEqual(departures.map((time) => `2026-10-20T${time}:00+09:00`));
  });

  it("reads today in Asia/Seoul: at 01:30 KST on the 20th (UTC the 19th) a 17:00 run of the 19th is gone", () => {
    // Arrange
    const runs = [run("2026-10-19", "17:00"), run("2026-10-20", "14:00")];

    // Act
    const arrivals = toTimetableArrivals(runs, BOARD, new Date("2026-10-19T16:30:00.000Z"));

    // Assert
    expect(departuresOf(arrivals)).toEqual(["2026-10-20T14:00:00+09:00"]);
  });

  it("serves an estimated drop-off as the expected arrival, and lists that run until it arrives, after its departure", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:00", { dropOff: estimated(kst("2026-10-20", "15:10")) }), run("2026-10-20", "14:30")];

    // Act
    const arrivals = toTimetableArrivals(runs, ALIGHT, new Date("2026-10-20T05:40:00.000Z"));

    // Assert
    expect(arrivals).toEqual([
      expect.objectContaining({ runDepartureAt: "2026-10-20T14:00:00+09:00", expectedArrivalAt: "2026-10-20T15:10:00+09:00", scheduledArrivalAt: null, basis: "estimate" }),
    ]);
  });

  it("orders a run with no time at the stop by its departure", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:30", { dropOff: estimated(kst("2026-10-20", "15:20")) }), run("2026-10-20", "15:00"), run("2026-10-20", "15:30")];

    // Act
    const arrivals = toTimetableArrivals(runs, ALIGHT, AT_14_10_KST);

    // Assert
    expect(arrivals.map(({ runDepartureAt, expectedArrivalAt, scheduledArrivalAt }) => [runDepartureAt, expectedArrivalAt, scheduledArrivalAt])).toEqual([
      ["2026-10-20T15:00:00+09:00", null, null],
      ["2026-10-20T14:30:00+09:00", "2026-10-20T15:20:00+09:00", null],
      ["2026-10-20T15:30:00+09:00", null, null],
    ]);
  });

  it("serves a timetable time at the stop as the timetable's", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:30", { dropOff: timetable(kst("2026-10-20", "15:20")) })];

    // Act & Assert
    expect(toTimetableArrivals(runs, ALIGHT, AT_14_10_KST)).toEqual([
      expect.objectContaining({ expectedArrivalAt: null, scheduledArrivalAt: "2026-10-20T15:20:00+09:00", basis: "timetable" }),
    ]);
  });

  it("serves a time at a scheduled stop as the timetable's, even on an estimated run", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:30", { dropOff: estimated(kst("2026-10-20", "15:20")), estimate: { source: "live", updatedAt: AT_14_10_KST } })];

    // Act & Assert
    expect(toTimetableArrivals(runs, BOARD, AT_14_10_KST)[0]).toMatchObject({ scheduledDepartureAt: "2026-10-20T14:30:00+09:00", expectedDepartureAt: null, basis: "timetable" });
  });

  it("serves a stop time past midnight at its own instant, the next day's, and lists the run until then", () => {
    // Arrange
    const runs = [run("2026-10-20", "23:50", { dropOff: timetable(kst("2026-10-21", "00:20")) })];

    // Act
    const arrivals = toTimetableArrivals(runs, ALIGHT, new Date("2026-10-20T15:05:00.000Z"));

    // Assert
    expect(arrivals).toEqual([expect.objectContaining({ runDepartureAt: "2026-10-20T23:50:00+09:00", scheduledArrivalAt: "2026-10-21T00:20:00+09:00" })]);
  });

  it("lists the next day's runs once today's are gone, and only the stop's route type, each with its last-bus flag", () => {
    // Arrange
    const runs = [
      run("2026-10-20", "14:00", { isLastOfDay: true }),
      run("2026-10-20", "14:20", { routeType: "hakbu", isLastOfDay: true }),
      run("2026-10-21", "09:00"),
      run("2026-10-21", "10:00", { isLastOfDay: true }),
      run("2026-10-22", "09:00"),
    ];

    // Act
    const arrivals = toTimetableArrivals(runs, BOARD, AT_14_10_KST);

    // Assert
    expect(arrivals.map(({ runDepartureAt, isLastBus }) => [runDepartureAt, isLastBus])).toEqual([
      ["2026-10-21T09:00:00+09:00", false],
      ["2026-10-21T10:00:00+09:00", true],
      ["2026-10-22T09:00:00+09:00", false],
    ]);
  });

  it("reads a run without stop times by its departure", () => {
    // Arrange
    const runs = [run("2026-10-20", "14:30", { stopTimes: [] })];

    // Act & Assert
    expect(toTimetableArrivals(runs, ALIGHT, AT_14_10_KST)).toEqual([
      expect.objectContaining({ runDepartureAt: "2026-10-20T14:30:00+09:00", scheduledArrivalAt: null, expectedArrivalAt: null }),
    ]);
  });
});

// WHY: the smart view stops serving a live value 15 minutes after its fetch, while the bus is still on the road.
describe("toTimetableArrivals with each run's latest estimate", () => {
  const at = (time: string) => kst("2026-10-20", time);
  const arrivalsAt = (dropOff: RunStopTime, now: Date) => toTimetableArrivals([run("2026-10-20", "14:00", { dropOff })], ALIGHT, now);

  it("lists a run with a fresh served estimate until that arrival, as before", () => {
    // Arrange
    const dropOff = estimated(at("15:10"));

    // Act
    const arrivals = arrivalsAt(dropOff, at("15:10"));

    // Assert
    expect(arrivals).toEqual([expect.objectContaining({ runDepartureAt: "2026-10-20T14:00:00+09:00", expectedArrivalAt: "2026-10-20T15:10:00+09:00", basis: "estimate" })]);
    expect(arrivalsAt(dropOff, at("15:11"))).toEqual([]);
  });

  it.each([
    ["14:10", true],
    ["15:10", true],
    ["15:11", false],
  ])("with only a live value too old to serve, at %s KST lists the 14:00 run: %s, showing no time", (now, listed) => {
    // Arrange
    const dropOff: RunStopTime = { shownAt: null, isEstimated: false, latestEstimateAt: at("15:10") };

    // Act
    const arrivals = arrivalsAt(dropOff, at(now));

    // Assert
    expect(arrivals).toEqual(
      listed ? [expect.objectContaining({ runDepartureAt: "2026-10-20T14:00:00+09:00", expectedArrivalAt: null, scheduledArrivalAt: null, basis: "timetable" })] : [],
    );
  });

  it("counts a run with no estimate at all by its departure", () => {
    // Act & Assert
    expect(arrivalsAt(timetable(null), at("14:00"))).toEqual([expect.objectContaining({ runDepartureAt: "2026-10-20T14:00:00+09:00", expectedArrivalAt: null })]);
    expect(arrivalsAt(timetable(null), at("14:01"))).toEqual([]);
  });

  it("keeps a run listed until the shown prediction when a live value fetched after it arrives earlier", () => {
    // Arrange
    const dropOff = estimated(at("15:20"), at("15:10"));

    // Act
    const arrivals = arrivalsAt(dropOff, at("15:20"));

    // Assert
    expect(arrivals).toEqual([expect.objectContaining({ expectedArrivalAt: "2026-10-20T15:20:00+09:00", basis: "estimate" })]);
    expect(arrivalsAt(dropOff, at("15:21"))).toEqual([]);
  });

  it("lists a run until a live value fetched after the shown prediction arrives, when that is later, still showing the prediction", () => {
    // Arrange
    const dropOff = estimated(at("15:05"), at("15:15"));

    // Act
    const arrivals = arrivalsAt(dropOff, at("15:15"));

    // Assert
    expect(arrivals).toEqual([expect.objectContaining({ expectedArrivalAt: "2026-10-20T15:05:00+09:00", basis: "estimate" })]);
    expect(arrivalsAt(dropOff, at("15:16"))).toEqual([]);
  });

  it("keeps a timetable time the stop shows as the cutoff", () => {
    // Arrange
    const dropOff: RunStopTime = { shownAt: at("15:20"), isEstimated: false, latestEstimateAt: at("15:10") };

    // Act
    const arrivals = arrivalsAt(dropOff, at("15:15"));

    // Assert
    expect(arrivals).toEqual([expect.objectContaining({ scheduledArrivalAt: "2026-10-20T15:20:00+09:00", basis: "timetable" })]);
  });

  it("orders runs by the time they are listed until", () => {
    // Arrange
    const runs = [
      run("2026-10-20", "14:00", { dropOff: { shownAt: null, isEstimated: false, latestEstimateAt: at("15:10") } }),
      run("2026-10-20", "14:20", { dropOff: estimated(at("15:00")) }),
    ];

    // Act
    const arrivals = toTimetableArrivals(runs, ALIGHT, at("14:30"));

    // Assert
    expect(departuresOf(arrivals)).toEqual(["2026-10-20T14:20:00+09:00", "2026-10-20T14:00:00+09:00"]);
  });
});
