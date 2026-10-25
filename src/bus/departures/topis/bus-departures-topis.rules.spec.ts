/**
 * What the TOPIS door decides (ADR 0022, D6 and D7; docs/plans/transit-route-planner.md "The doors"): which station
 * indexes of a route a stop is at, read only while the live group's stations version is the index's; which board
 * and alight stations a leg rides between, the alight after the board; a stop's service day from TOPIS's first and
 * last run, read by time of day so a last run after midnight belongs to the day before; and the board itself: the
 * predicted vehicles at the board station with a time, each call as the live route serves it, joined to the same
 * vehicle's call at the alight station; past them, half a headway from `term` while the stop's service day runs, and
 * nothing without `term`; a route TOPIS says has ended, or whose last run has passed, lists no headway and names the
 * next service day's first run; before the first run it lists that run, from the timetable, when it falls in the window.
 * The journey push refuses a ride the door could not place: a stop off the route, or an alight not after the board.
 */
import type { Call } from "../../../shared/call.wire";
import type { DepartureQuery } from "../../../shared/departure.types";
import type { Vehicle } from "../../bus.wire";
import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { LiveGroup, LiveStation } from "../../live/bus-live.wire";
import type { StopRoute } from "../../stop-index/bus-stop-index.types";
import { toLegStations, toRouteStationIndexes, toServiceSpan, toTopisBoard, toTopisRideIssue } from "./bus-departures-topis.rules";

const kst = (local: string) => new Date(`${local}+09:00`);
const AT_18_58 = kst("2026-10-25T18:58:40");
const HOUR_MS = 3_600_000;

const query = (from = AT_18_58): DepartureQuery => ({ lineId: "gyeonggi7800", boardStopId: "119000302", alightStopId: "200000159", from, until: new Date(from.getTime() + 3 * HOUR_MS), lang: "ko" });

function call(extra: Partial<Call> = {}): Call {
  return {
    status: "enRoute",
    ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
    basis: "provider",
    ...{ stopsAway: 3, runId: null, vehicleId: null, headsign: "호매실동차고지 방면", isFirstRun: null, isLastRun: false, isExpress: null, providerText: null },
    ...extra,
  };
}

const station = (stationIndex: number, arrivals: Call[], operation: LiveStation["operation"] = "running"): LiveStation => ({ stationIndex, stopId: null, arsId: null, operation, arrivals });

function vehicle(id: string, seatsLeft: number | null): Vehicle {
  return { id, plateNumber: "경기70아1234", occupancy: null, seatsLeft, isLowFloor: false, position: null, trajectory: null };
}

function group(stations: LiveStation[], vehicles: Vehicle[] = []): LiveGroup {
  return { groupId: "gyeonggi7800", stationsVersion: "v1", updatedAt: "2026-10-25T18:58:35+09:00", operation: "running", vehicles, stations };
}

function row(extra: Partial<JongroArrivalDoc> = {}): JongroArrivalDoc {
  return {
    ...{ stationId: "119000302", sequence: "41", stationName: "사당역9번출구앞", carNumber: "", eventDate: "2026-10-25 18:58:33.0", stationNumber: "20253", eta: "", buses: [] },
    ...{ term: 10, firstTm: "2026-10-25T05:52:00+09:00", lastTm: "2026-10-25T23:50:00+09:00" },
    ...extra,
  };
}

const LEG = { boardIndex: 40, alightIndex: 57 };
const FIRST = call({ expectedArrivalAt: "2026-10-25T19:01:53+09:00", vehicleId: "200011607", providerText: "3분20초후[2번째 전]" });
const SECOND = call({ expectedArrivalAt: "2026-10-25T19:15:50+09:00", vehicleId: "200010898", stopsAway: 9, providerText: "17분17초후[8번째 전]" });

describe("toRouteStationIndexes", () => {
  const jongro = (groupId: string, stationIndex: number, stationsVersion = "v1"): StopRoute => ({ kind: "jongro", groupId, stationIndex, towards: null, stationsVersion });

  it("reads the stop's indexes on the route, only while the live group's stations version is the index's", () => {
    // Arrange
    const stop = { routes: [jongro("gyeonggi7800", 40), jongro("jongro08", 3), { kind: "hssc" as const, groupId: "hssc", stationIndex: 2 }] };

    // Act & Assert
    expect(toRouteStationIndexes(stop, "gyeonggi7800", "v1")).toEqual([40]);
    expect(toRouteStationIndexes(stop, "gyeonggi7800", "v2")).toEqual([]);
    expect(toRouteStationIndexes(null, "gyeonggi7800", "v1")).toEqual([]);
  });
});

describe("toLegStations", () => {
  it("rides from the board station to the nearest alight station after it", () => {
    // Act & Assert
    expect(toLegStations([40], [57])).toEqual({ boardIndex: 40, alightIndex: 57 });
    expect(toLegStations([3, 28], [16, 30])).toEqual({ boardIndex: 28, alightIndex: 30 });
  });

  it("Reversed pair: places nothing when the alight station comes before the board station", () => {
    // Act & Assert
    expect(toLegStations([57], [40])).toBeNull();
    expect(toLegStations([], [40])).toBeNull();
  });

  it("places only the board with no alight stop asked for", () => {
    // Act & Assert
    expect(toLegStations([40], null)).toEqual({ boardIndex: 40, alightIndex: null });
  });
});

describe("toServiceSpan", () => {
  const SPAN = { startsAt: kst("2026-10-25T06:26:00"), endsAt: kst("2026-10-26T00:23:00") };
  const AFTER_MIDNIGHT = row({ firstTm: "2026-10-25T06:26:00+09:00", lastTm: "2026-10-26T00:23:00+09:00" });

  it.each([
    ["one minute before the last run", "2026-10-26T00:22:00", SPAN],
    ["at the last run", "2026-10-26T00:23:00", SPAN],
    ["one minute after it", "2026-10-26T00:24:00", { startsAt: kst("2026-10-26T06:26:00"), endsAt: kst("2026-10-27T00:23:00") }],
  ])("reads the day ending at or after the instant, %s", (_case, at, expected) => {
    // Act & Assert
    expect(toServiceSpan(AFTER_MIDNIGHT, kst(at))).toEqual(expected);
  });

  it("is the KST service day at 01:30 KST, when the UTC date is still the day before", () => {
    // Act
    const span = toServiceSpan(row(), new Date("2026-10-25T16:30:00.000Z"));

    // Assert
    expect(span?.startsAt.toISOString()).toBe("2026-10-25T20:52:00.000Z");
    expect(span?.startsAt.toISOString()).not.toBe("2026-10-24T20:52:00.000Z");
  });

  it("reads the time of day, so rows TOPIS still dates the day before serve the next day", () => {
    // Act & Assert
    expect(toServiceSpan(row(), kst("2026-10-26T07:00:00"))).toEqual({ startsAt: kst("2026-10-26T05:52:00"), endsAt: kst("2026-10-26T23:50:00") });
  });

  it("knows no span without both runs", () => {
    // Act & Assert
    expect(toServiceSpan(row({ firstTm: undefined }), AT_18_58)).toBeNull();
  });
});

describe("toTopisBoard", () => {
  it("lists the predicted vehicles at the board station as the live route serves them, joined to the same vehicle at the alight station", () => {
    // Arrange
    const standing = call({ status: "arriving", stopsAway: 0, vehicleId: "200011999" });
    const atAlight = call({ expectedArrivalAt: "2026-10-25T19:36:10+09:00", vehicleId: "200011607" });
    const live = group([station(40, [standing, FIRST, SECOND]), station(57, [atAlight])], [vehicle("200011607", 12), vehicle("200010898", null), vehicle("200011999", 3)]);

    // Act
    const board = toTopisBoard({ group: live, row: row(), legStations: LEG, query: query() });

    // Assert
    expect(board.departures.map(({ board: boardCall, alight }) => [boardCall.vehicleId, boardCall.expectedArrivalAt, alight?.expectedArrivalAt ?? null])).toEqual([
      ["200011607", kst("2026-10-25T19:01:53"), kst("2026-10-25T19:36:10")],
      ["200010898", kst("2026-10-25T19:15:50"), null],
    ]);
    expect(board.departures[0]).toMatchObject({ lineId: "gyeonggi7800", observedAt: kst("2026-10-25T18:58:35"), board: { providerText: "3분20초후[2번째 전]", headsign: "호매실동차고지 방면", basis: "provider" } });
    expect(board.vehicles).toEqual({
      "200011607": { id: "200011607", occupancy: null, seatsLeft: 12, isLowFloor: false },
      "200010898": { id: "200010898", occupancy: null, seatsLeft: null, isLowFloor: false },
    });
  });

  it("boards past the predicted vehicles at half the headway until the stop's last run, and names the next day's first run", () => {
    // Act
    const board = toTopisBoard({ group: group([station(40, [FIRST, SECOND])]), row: row(), legStations: LEG, query: query() });

    // Assert
    expect(board.continuation).toEqual({ kind: "headway", headwaySec: 600, serviceEndsAt: kst("2026-10-25T23:50:00") });
    expect(board.nextServiceAt).toEqual(kst("2026-10-26T05:52:00"));
  });

  it("No term: lists only the predicted vehicles, with no extrapolation", () => {
    // Act
    const board = toTopisBoard({ group: group([station(40, [FIRST])]), row: row({ term: undefined }), legStations: LEG, query: query() });

    // Assert
    expect(board.continuation).toEqual({ kind: "listed" });
    expect(board.departures).toHaveLength(1);
  });

  it("Ended: lists no headway when TOPIS says the service ended at the board station, and names the next day's first run", () => {
    // Arrange
    const live = group([station(40, [], "ended")]);

    // Act
    const board = toTopisBoard({ group: live, row: row(), legStations: LEG, query: query(kst("2026-10-25T22:40:00")) });

    // Assert
    expect(board).toEqual({ departures: [], vehicles: {}, continuation: { kind: "listed" }, nextServiceAt: kst("2026-10-26T05:52:00") });
  });

  it("Past the last run: lists no headway, still lists a predicted last bus, and names the next day's first run at 01:30 KST", () => {
    // Arrange
    const lastBus = call({ expectedArrivalAt: "2026-10-26T01:33:00+09:00", vehicleId: "200011607", isLastRun: true });
    const at0130 = new Date("2026-10-25T16:30:00.000Z");

    // Act
    const board = toTopisBoard({ group: group([station(40, [lastBus])], [vehicle("200011607", 5)]), row: row(), legStations: LEG, query: query(at0130) });

    // Assert
    expect(board.departures.map(({ board: boardCall }) => boardCall.vehicleId)).toEqual(["200011607"]);
    expect(board.continuation).toEqual({ kind: "listed" });
    expect(board.nextServiceAt).toEqual(kst("2026-10-26T05:52:00"));
    expect(board.nextServiceAt).not.toEqual(kst("2026-10-25T05:52:00"));
  });

  it("Before the first run, inside the window: lists that run from the timetable, with no vehicle, and boards at half the headway after it", () => {
    // Arrange
    const at0400 = kst("2026-10-26T04:00:00");

    // Act
    const board = toTopisBoard({ group: group([station(40, [])]), row: row(), legStations: LEG, query: query(at0400) });

    // Assert
    expect(board.departures.map(({ board: boardCall, alight }) => ({ ...boardCall, alight }))).toEqual([
      {
        status: "scheduled",
        ...{ expectedArrivalAt: null, expectedDepartureAt: null, scheduledArrivalAt: kst("2026-10-26T05:52:00"), scheduledDepartureAt: null },
        basis: "timetable",
        ...{ stopsAway: null, runId: null, vehicleId: null, headsign: null, isFirstRun: true, isLastRun: false, isExpress: null, providerText: null },
        alight: null,
      },
    ]);
    expect(board.continuation).toEqual({ kind: "headway", headwaySec: 600, serviceEndsAt: kst("2026-10-26T23:50:00") });
    expect(board.nextServiceAt).toEqual(kst("2026-10-27T05:52:00"));
  });

  it("Before the first run, past the window: lists nothing and names today's first run", () => {
    // Arrange
    const at0130 = new Date("2026-10-25T16:30:00.000Z");
    const live = group([station(40, [])]);

    // Act
    const board = toTopisBoard({ group: live, row: row({ firstTm: "2026-10-25T06:00:00+09:00", lastTm: "2026-10-25T23:20:00+09:00" }), legStations: LEG, query: query(at0130) });

    // Assert
    expect(board).toEqual({ departures: [], vehicles: {}, continuation: { kind: "listed" }, nextServiceAt: kst("2026-10-26T06:00:00") });
  });

  it("names no next service when the row carries no first and last run", () => {
    // Act
    const board = toTopisBoard({ group: group([station(40, [FIRST])]), row: row({ firstTm: undefined, lastTm: undefined }), legStations: LEG, query: query() });

    // Assert
    expect(board.nextServiceAt).toBeNull();
    expect(board.continuation).toEqual({ kind: "headway", headwaySec: 600, serviceEndsAt: null });
  });
});

describe("toTopisRideIssue", () => {
  const jongro = (groupId: string, stationIndex: number): StopRoute => ({ kind: "jongro", groupId, stationIndex, towards: null, stationsVersion: "v1" });
  const STOPS = new Map([
    ["119000302", { routes: [jongro("gyeonggi7800", 40)] }],
    ["200000159", { routes: [jongro("gyeonggi7800", 57)] }],
    ["100900046", { routes: [jongro("jongro08", 3)] }],
  ]);
  const stopOf = (stopId: string) => STOPS.get(stopId) ?? null;

  it("accepts a ride that boards before it alights on the route", () => {
    // Act & Assert
    expect(toTopisRideIssue(stopOf, { lineId: "gyeonggi7800", boardStopId: "119000302", alightStopId: "200000159" })).toBeNull();
  });

  it("refuses a stop off the route, and a stop no index holds", () => {
    // Act & Assert
    expect(toTopisRideIssue(stopOf, { lineId: "gyeonggi7800", boardStopId: "100900046", alightStopId: "200000159" })).toBe("gyeonggi7800 does not call at 100900046");
    expect(toTopisRideIssue(stopOf, { lineId: "gyeonggi7800", boardStopId: "119000302", alightStopId: "sadang-nowhere" })).toBe("gyeonggi7800 does not call at sadang-nowhere");
  });

  it("Reversed pair: refuses an alight before the board", () => {
    // Act & Assert
    expect(toTopisRideIssue(stopOf, { lineId: "gyeonggi7800", boardStopId: "200000159", alightStopId: "119000302" })).toBe("gyeonggi7800 does not call at 200000159 and then at 119000302");
  });
});
