/**
 * The registry's sync rules (improve-jongro-realtime D6, D9): the stations
 * version is a stable hash of the ordered stations and the turnaround stop;
 * an observation is the arrival list ordered by ord; the turnaround stop
 * follows the position list only when its rows agree; the changed share and
 * the diff of two lists; and the decision to wait, apply at the third
 * identical tick, or hold a change to more than 30% of the stops. A
 * route with no document is bootstrapped (isolate-api-from-pollers D2): only a
 * non-empty list with a turnaround stop every position row agrees on counts,
 * by its stations version, and the third identical tick inserts it.
 */
import type { ObservedStation, PendingObservation } from "./bus-registry.types";
import {
  toAgreedTurnaroundTopisId,
  toBootstrapDecision,
  toChangedShare,
  toObservedStations,
  toStationDiff,
  toStationsVersion,
  toSyncDecision,
  toTurnaroundTopisId,
} from "./bus-registry.rules";

const stop = (topisId: string, stationName = `stop ${topisId}`, arsId = `ars ${topisId}`): ObservedStation => ({ topisId, arsId, stationName });
const stops = (...topisIds: string[]): ObservedStation[] => topisIds.map((id) => stop(id));
const TEN = stops("1", "2", "3", "4", "5", "6", "7", "8", "9", "10");

describe("toStationsVersion", () => {
  it("is 16 hex characters and the same for identical lists", () => {
    // Act
    const version = toStationsVersion(stops("A", "B", "C"), "B");

    // Assert
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(toStationsVersion(stops("A", "B", "C"), "B")).toBe(version);
  });

  it.each([
    ["a renamed stop", [stop("A"), stop("B", "new name"), stop("C")], "B"],
    ["a new ARS number", [stop("A"), stop("B", "stop B", "ars X"), stop("C")], "B"],
    ["a reorder", stops("A", "C", "B"), "B"],
    ["an added stop", stops("A", "B", "C", "D"), "B"],
    ["another turnaround stop", stops("A", "B", "C"), "C"],
  ])("changes for %s", (_case, stations, turnaroundTopisId) => {
    // Act & Assert
    expect(toStationsVersion(stations, turnaroundTopisId)).not.toBe(toStationsVersion(stops("A", "B", "C"), "B"));
  });
});

describe("toObservedStations", () => {
  it("orders the arrival rows by ord, numerically", () => {
    // Arrange
    const row = (stationId: string, sequence: string) => ({ stationId, sequence, stationName: `n${stationId}`, stationNumber: `a${stationId}` });

    // Act
    const observed = toObservedStations([row("C", "10"), row("A", "1"), row("B", "2")]);

    // Assert
    expect(observed).toEqual([
      { topisId: "A", arsId: "aA", stationName: "nA" },
      { topisId: "B", arsId: "aB", stationName: "nB" },
      { topisId: "C", arsId: "aC", stationName: "nC" },
    ]);
  });

  it("reads TOPIS's no-result answer as no stations", () => {
    // Act & Assert
    expect(toObservedStations([])).toEqual([]);
  });
});

describe("toTurnaroundTopisId", () => {
  it.each([
    ["the position rows agree", ["T2", "T2"], "T2"],
    ["no bus is running", [], "T1"],
    ["the rows disagree", ["T2", "T3"], "T1"],
    ["a row has no id", ["T2", ""], "T1"],
    ["the rows name no turnaround stop", [undefined, undefined], "T1"],
  ])("when %s", (_case, sightingIds, expected) => {
    // Act & Assert
    expect(toTurnaroundTopisId(sightingIds, "T1")).toBe(expected);
  });
});

describe("toAgreedTurnaroundTopisId", () => {
  it.each([
    ["the position rows agree", ["T2", "T2"], "T2"],
    ["no bus is running", [], null],
    ["the rows disagree", ["T2", "T3"], null],
    ["a row has no id", ["T2", ""], null],
    ["the rows name no turnaround stop", [undefined, undefined], null],
  ])("when %s", (_case, sightingIds, expected) => {
    // Act & Assert
    expect(toAgreedTurnaroundTopisId(sightingIds)).toBe(expected);
  });
});

describe("toBootstrapDecision", () => {
  const pendingOf = (stationsVersion: string, count: number): PendingObservation => ({ stationsVersion, count });
  const version = toStationsVersion(TEN, "5");

  it.each([
    ["a first tick", undefined, { kind: "pending", pending: pendingOf(version, 1) }],
    ["a second identical tick", pendingOf(version, 1), { kind: "pending", pending: pendingOf(version, 2) }],
    ["a third identical tick", pendingOf(version, 2), { kind: "insert", stationsVersion: version, turnaroundTopisId: "5" }],
    ["a different list after two", pendingOf("other", 2), { kind: "pending", pending: pendingOf(version, 1) }],
  ])("on %s", (_case, pending, expected) => {
    // Act & Assert
    expect(toBootstrapDecision({ stations: TEN, turnaroundTopisId: "5", pending })).toEqual(expected);
  });

  it("counts the same stops with another turnaround stop as a different list", () => {
    // Act & Assert
    expect(toBootstrapDecision({ stations: TEN, turnaroundTopisId: "6", pending: pendingOf(version, 2) })).toEqual({
      kind: "pending",
      pending: pendingOf(toStationsVersion(TEN, "6"), 1),
    });
  });

  it.each([
    ["an empty list", [], "5"],
    ["no agreed turnaround stop", TEN, null],
  ])("counts nothing for %s", (_case, stations, turnaroundTopisId) => {
    // Act & Assert
    expect(toBootstrapDecision({ stations, turnaroundTopisId, pending: pendingOf(version, 2) })).toEqual({ kind: "skip" });
  });
});

describe("toChangedShare", () => {
  it.each([
    ["identical lists", TEN, 0],
    ["a pure rename", [...TEN.slice(0, 9), stop("10", "renamed")], 0],
    ["one stop added at the end", [...TEN, stop("11")], 1 / 11],
    ["two stops swapped", [TEN[1]!, TEN[0]!, ...TEN.slice(2)], 1 / 10],
    ["one stop inserted mid-route", [...TEN.slice(0, 5), stop("X"), ...TEN.slice(5)], 1 / 11],
    ["one stop dropped mid-route", [...TEN.slice(0, 5), ...TEN.slice(6)], 1 / 10],
    ["the list reversed", [...TEN].reverse(), 9 / 10],
    ["three stops replaced", [...stops("X", "Y", "Z"), ...TEN.slice(3)], 3 / 10],
    ["four stops replaced", [...stops("W", "X", "Y", "Z"), ...TEN.slice(4)], 4 / 10],
  ])("%s", (_case, observed, expected) => {
    // Act & Assert
    expect(toChangedShare(TEN, observed)).toBeCloseTo(expected);
  });
});

describe("toStationDiff", () => {
  it("names the stops added, removed, moved and renamed, with their ords", () => {
    // Arrange
    const stored = stops("A", "B", "C", "D");
    const observed = [stop("A"), stop("C"), stop("B", "B renamed"), stop("E")];

    // Act
    const diff = toStationDiff(stored, observed);

    // Assert
    expect(diff).toEqual({
      added: [{ ord: 4, topisId: "E", stationName: "stop E" }],
      removed: [{ ord: 4, topisId: "D", stationName: "stop D" }],
      moved: [
        { fromOrd: 3, toOrd: 2, topisId: "C", stationName: "stop C" },
        { fromOrd: 2, toOrd: 3, topisId: "B", stationName: "B renamed" },
      ],
      renamed: [{ ord: 3, topisId: "B", fromName: "stop B", toName: "B renamed" }],
    });
  });

  it("keeps a loop-closing repeat apart from its first ord", () => {
    // Act
    const diff = toStationDiff(stops("A", "B", "A"), stops("A", "B", "C", "A"));

    // Assert
    expect(diff).toEqual({
      added: [{ ord: 3, topisId: "C", stationName: "stop C" }],
      removed: [],
      moved: [{ fromOrd: 3, toOrd: 4, topisId: "A", stationName: "stop A" }],
      renamed: [],
    });
  });
});

describe("toSyncDecision", () => {
  const pendingOf = (stationsVersion: string, count: number): PendingObservation => ({ stationsVersion, count });

  it("clears the count when the observation equals the stored list", () => {
    // Act & Assert
    expect(toSyncDecision({ storedVersion: "stored", observedVersion: "stored", pending: pendingOf("new", 2), changedShare: 0 })).toEqual({ kind: "unchanged" });
  });

  it.each([
    ["a first differing tick", undefined, { kind: "pending", pending: pendingOf("new", 1) }],
    ["a second identical tick", pendingOf("new", 1), { kind: "pending", pending: pendingOf("new", 2) }],
    ["a third identical tick", pendingOf("new", 2), { kind: "apply" }],
    ["a different list after two", pendingOf("other", 2), { kind: "pending", pending: pendingOf("new", 1) }],
  ])("on %s", (_case, pending, expected) => {
    // Act & Assert
    expect(toSyncDecision({ storedVersion: "stored", observedVersion: "new", pending, changedShare: 0.1 })).toEqual(expected);
  });

  it.each([
    [0.3, { kind: "apply" }],
    [0.31, { kind: "hold", pending: { stationsVersion: "new", count: 3 } }],
  ])("at the third tick, a changed share of %s → %j", (changedShare, expected) => {
    // Act & Assert
    expect(toSyncDecision({ storedVersion: "stored", observedVersion: "new", pending: pendingOf("new", 2), changedShare })).toEqual(expected);
  });

  it("keeps counting a held list", () => {
    // Act & Assert
    expect(toSyncDecision({ storedVersion: "stored", observedVersion: "new", pending: pendingOf("new", 4), changedShare: 0.5 })).toEqual({ kind: "hold", pending: pendingOf("new", 5) });
  });

  it("applies a turnaround-only change, which changes no stop, at the third tick", () => {
    // Arrange
    const version = toStationsVersion(TEN, "5");

    // Act & Assert
    expect(toSyncDecision({ storedVersion: toStationsVersion(TEN, "4"), observedVersion: version, pending: pendingOf(version, 2), changedShare: toChangedShare(TEN, TEN) })).toEqual({ kind: "apply" });
  });
});
