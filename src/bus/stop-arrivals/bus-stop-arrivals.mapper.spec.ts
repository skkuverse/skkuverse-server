/**
 * How a stop page is assembled: the stop block, from its
 * config record for a local stop (coordinates from its pole when it has none, aliases as arsIds) or from its pole
 * for a TOPIS one; a live entry carrying the live route's station entry at its index and the vehicles it names
 * (ADR 0019, D12) with the direction (right after towards) and the action given (board, or alight at a drop-off-only
 * station); and a timetable entry carrying its runs, each a run's stop call served with its departure from the
 * origin. The HSSC line named by its catalog stops moved with
 * toCatalogNamedLine to src/bus/bus.mapper.spec.ts.
 */
import type { BusStopsSnapshot } from "../stops/bus-stops.types";
import type { FoundStop } from "../stop-index/bus-stop-index.types";
import type { Arrival, Vehicle } from "../bus.wire";
import type { LiveGroup } from "../live/bus-live.wire";
import { toLiveEntry, toStopBlock, toTimetableArrival, toTimetableEntry } from "./bus-stop-arrivals.mapper";

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

const arrival = (vehicleId: string | null, providerText: string): Arrival => ({
  status: "enRoute",
  expectedArrivalAt: "2026-10-20T14:14:00+09:00",
  ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
  basis: "provider",
  stopsAway: 2,
  isLastBus: false,
  vehicleId,
  providerText,
});
const vehicle = (id: string): Vehicle => ({ id, plateNumber: null, occupancy: null, isLastBus: null, isLowFloor: null, position: null, trajectory: null });

describe("toLiveEntry", () => {
  const group: LiveGroup = {
    groupId: "jongro07",
    stationsVersion: "abc",
    updatedAt: "2026-10-20T14:09:55+09:00",
    operation: "running",
    vehicles: [vehicle("a"), vehicle("b"), vehicle("c")],
    stations: [
      { stationIndex: 15, stopId: "seoul-01591", arsId: "01591", operation: "running", arrivals: [arrival("c", "other")] },
      { stationIndex: 16, stopId: "seoul-01592", arsId: "01592", operation: "running", arrivals: [arrival("a", "4분후[2번째 전]"), arrival(null, "출발대기")] },
    ],
  };

  it("carries the live route's station entry at its index and only the vehicles its arrivals name", () => {
    // Act & Assert
    expect(toLiveEntry({ groupId: "jongro07", stationIndex: 16 }, group, { label: "종로 07", towards: "혜화동로터리", direction: null, action: "board" })).toEqual({
      kind: "live",
      groupId: "jongro07",
      label: "종로 07",
      stationIndex: 16,
      towards: "혜화동로터리",
      direction: null,
      action: "board",
      stationsVersion: "abc",
      updatedAt: "2026-10-20T14:09:55+09:00",
      operation: "running",
      vehicles: [vehicle("a")],
      arrivals: [arrival("a", "4분후[2번째 전]"), arrival(null, "출발대기")],
    });
  });

  it("serves no data and no arrival at a station the live route states nothing for", () => {
    // Act & Assert
    expect(toLiveEntry({ groupId: "jongro07", stationIndex: 3 }, group, { label: "종로 07", towards: null, direction: null, action: "board" })).toMatchObject({ operation: "noData", vehicles: [], arrivals: [] });
  });

  it("serves the action it is given, alight at a drop-off-only station, after towards and the direction", () => {
    // Act
    const entry = toLiveEntry({ groupId: "hssc", stationIndex: 3 }, { ...group, groupId: "hssc", stationsVersion: null }, { label: "인사캠 셔틀버스", towards: "혜화동우체국", direction: { id: "fromCampus", label: "하교" }, action: "alight" });

    // Assert
    expect(entry.action).toBe("alight");
    expect(entry.direction).toEqual({ id: "fromCampus", label: "하교" });
    expect(Object.keys(entry).slice(0, 7)).toEqual(["kind", "groupId", "label", "stationIndex", "towards", "direction", "action"]);
  });
});

describe("toTimetableEntry", () => {
  it("carries the run's service, route type, action, operation and runs, with no vehicle", () => {
    // Arrange
    const route = { kind: "shuttle" as const, groupId: "campus", serviceId: "campus-inja", routeType: "regular", sequenceIndex: 0, action: "board" as const };
    const arrivals = [{ ...arrival(null, ""), status: "scheduled" as const, providerText: null, runDepartureAt: "2026-10-20T14:30:00+09:00" }];

    // Act & Assert
    expect(toTimetableEntry(route, "인사캠 → 자과캠", { operation: "running", arrivals })).toEqual({
      kind: "timetable",
      groupId: "campus",
      label: "인사캠 → 자과캠",
      serviceId: "campus-inja",
      routeType: "regular",
      action: "board",
      operation: "running",
      vehicles: [],
      arrivals,
    });
  });
});

describe("toTimetableArrival", () => {
  it("serves a run's call as the wire arrival with its departure from the origin last, both at +09:00, and no run id", () => {
    // Arrange
    const call = {
      status: "scheduled" as const,
      ...{ expectedArrivalAt: new Date("2026-10-22T15:52:00Z"), expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
      basis: "estimate" as const,
      stopsAway: null,
      isLastBus: true,
      ...{ vehicleId: null, providerText: null },
      runId: "commute-jamsil|down|2026-10-22|23:30",
      runDepartureAt: new Date("2026-10-22T14:30:00Z"),
    };

    // Act
    const served = toTimetableArrival(call);

    // Assert
    expect(JSON.stringify(served)).toBe(
      JSON.stringify({
        status: "scheduled",
        expectedArrivalAt: "2026-10-23T00:52:00+09:00",
        expectedDepartureAt: null,
        scheduledArrivalAt: null,
        scheduledDepartureAt: null,
        basis: "estimate",
        stopsAway: null,
        isLastBus: true,
        vehicleId: null,
        providerText: null,
        runDepartureAt: "2026-10-22T23:30:00+09:00",
      }),
    );
  });
});
