/**
 * How a stop page is assembled (unify-bus-stops design D7-D9; spec bus-stop-arrivals): the stop block, from its
 * config record for a local stop (coordinates from its pole when it has none, aliases as arsIds) or from its pole
 * for a TOPIS one; a Jongno entry carrying its view's arrivals at its index; an HSSC entry; a shuttle entry.
 */
import type { BusStopsSnapshot } from "../stops/bus-stops.types";
import type { FoundStop } from "../stop-index/bus-stop-index.types";
import { toHsscEntry, toJongroEntry, toShuttleEntry, toStopBlock } from "./bus-stop-arrivals.mapper";

const SNAPSHOT = { revision: 1 } as BusStopsSnapshot;
const POLE = { arsId: "01592", topisId: "100900075", stationName: "혜화역1번출구" };
const found = (extra: Partial<FoundStop>): FoundStop => ({ id: "seoul-01592", localStop: null, poles: [POLE], routes: [], snapshot: SNAPSHOT, coords: null, ...extra });

describe("toStopBlock", () => {
  it("serves a TOPIS pole by its Korean name, its coordinates and its ARS number", () => {
    // Act & Assert
    expect(toStopBlock(found({ coords: { lat: 37.58, lng: 127 } }), null)).toEqual({ id: "seoul-01592", name: "혜화역1번출구", coords: { lat: 37.58, lng: 127 }, arsIds: ["01592"] });
  });

  it("leaves out the coordinates of a pole no route line lists", () => {
    // Act & Assert
    expect(toStopBlock(found({}), null)).toEqual({ id: "seoul-01592", name: "혜화역1번출구", arsIds: ["01592"] });
  });

  it("serves a local stop as its record, with no arsIds when it aliases none", () => {
    // Arrange
    const record = { id: "jeongja-exit3", name: "Jeongja Stn. Exit 3", coords: { lat: 37.36, lng: 127.1 }, photoUrl: "https://media.skkuverse.com/x.jpg" };
    const localStop = { id: "jeongja-exit3", name: { ko: "정자역 3번 출구" }, coords: { lat: 37.36, lng: 127.1 } };

    // Act & Assert
    expect(toStopBlock(found({ id: "jeongja-exit3", localStop, poles: [], coords: localStop.coords }), record)).toEqual(record);
  });

  it("serves an aliased local stop with its aliases and, lacking its own, its pole's coordinates", () => {
    // Arrange
    const record = { id: "hssc-student-center", name: "학생회관" };
    const localStop = { id: "hssc-student-center", name: { ko: "학생회관" }, arsIds: ["01618"] };

    // Act & Assert
    expect(toStopBlock(found({ id: "hssc-student-center", localStop, coords: { lat: 37.587, lng: 126.993 } }), record)).toEqual({
      id: "hssc-student-center",
      name: "학생회관",
      coords: { lat: 37.587, lng: 126.993 },
      arsIds: ["01618"],
    });
  });

  it("refuses a TOPIS stop with no pole, which the index never builds", () => {
    // Act & Assert
    expect(() => toStopBlock(found({ poles: [] }), null)).toThrow("seoul-01592");
  });
});

describe("toJongroEntry", () => {
  const ARRIVAL = { minutes: 4, stopsAway: 2, state: "running" as const, isLastBus: false, carNumber: "2701", crowding: null, passengerCount: null, message: "4분후[2번째 전]" };

  it("carries the view's arrivals at the entry's index and its stations version", () => {
    // Arrange
    const view = {
      buses: [],
      stationEtas: [
        { stationIndex: 15, eta: "x", arrivals: [{ ...ARRIVAL, message: "other" }] },
        { stationIndex: 16, eta: "4분후[2번째 전]", arrivals: [ARRIVAL] },
      ],
      stationsVersion: "abc",
    };

    // Act & Assert
    expect(toJongroEntry({ kind: "jongro", groupId: "jongro07", stationIndex: 16, towards: "혜화동로터리", stationsVersion: "abc" }, view, "종로 07")).toEqual({
      groupId: "jongro07",
      kind: "arrivals",
      label: "종로 07",
      stationIndex: 16,
      towards: "혜화동로터리",
      stationsVersion: "abc",
      arrivals: [ARRIVAL],
    });
  });

  it("serves no arrivals where the view has no row, and refuses a view with no stations version", () => {
    // Arrange
    const route = { kind: "jongro" as const, groupId: "jongro07", stationIndex: 16, towards: null, stationsVersion: "abc" };

    // Act & Assert
    expect(toJongroEntry(route, { buses: [], stationEtas: [], stationsVersion: "abc" }, "종로 07").arrivals).toEqual([]);
    expect(() => toJongroEntry(route, { buses: [], stationEtas: [] }, "종로 07")).toThrow("jongro07");
  });
});

describe("toHsscEntry", () => {
  it("carries the buses on their way", () => {
    // Act & Assert
    expect(toHsscEntry({ kind: "hssc", groupId: "hssc", stationIndex: 6 }, "인사캠 셔틀버스", [{ stopsAway: 2 }])).toEqual({
      groupId: "hssc",
      kind: "approaching",
      label: "인사캠 셔틀버스",
      stationIndex: 6,
      approaching: [{ stopsAway: 2 }],
    });
  });
});

describe("toShuttleEntry", () => {
  it("carries the run's service, route type, action, status and next runs", () => {
    // Arrange
    const route = { kind: "shuttle" as const, groupId: "campus", serviceId: "campus-inja", routeType: "regular", sequenceIndex: 0, action: "board" as const, timing: "scheduled" as const };
    const next = [{ date: "2026-10-20", departure: "14:30", time: "14:30", estimated: false }];

    // Act & Assert
    expect(toShuttleEntry(route, "인사캠 → 자과캠", { status: "active", next })).toEqual({
      groupId: "campus",
      kind: "schedule",
      label: "인사캠 → 자과캠",
      serviceId: "campus-inja",
      routeType: "regular",
      action: "board",
      status: "active",
      next,
    });
  });
});
