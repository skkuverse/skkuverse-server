/**
 * The route path rules: a line's length in
 * meters over its points, a version that changes with any point or station,
 * a station's direction included, and so differs from every version stored
 * before directions were (production's Jongno 07, 2026-10-18),
 * and the sync decision: unchanged content writes nothing, and a line of too
 * few points, no station, or a point count or length more than 30% off the
 * stored line is held, each at its threshold. With no stored line, only the
 * point and station checks hold a first line (ADR 0012, D3).
 */
import { capturedRoutePathOf } from "../../../__tests__/helpers/bus/bus-route-path";
import type { Position } from "../../shared/geojson.types";
import type { RoutePathStation } from "./bus-route-path.document";
import { toPathShape, toPathSyncDecision, toPathVersion } from "./bus-route-path.rules";
import type { PathShape } from "./bus-route-path.types";

const station: RoutePathStation = { topisId: "100900220", arsId: "01617", stationName: "성균관대운동장", sequence: 1, lng: 126.99237, lat: 37.587863, isTurnaround: false };
const STORED: PathShape = { pointCount: 100, lengthMeters: 5000 };
const decide = (shape: PathShape, stationCount = 22, pathVersion = "new") => toPathSyncDecision({ pathVersion: "old", shape: STORED }, { pathVersion, shape, stationCount });

describe("toPathShape", () => {
  it("counts the points and sums the great-circle length between neighbours, leaving the loop open", () => {
    // Arrange
    const path: Position[] = [
      [126.99, 37.58],
      [126.99, 37.59],
      [127.0, 37.59],
    ];

    // Act
    const shape = toPathShape(path);

    // Assert
    expect(shape.pointCount).toBe(3);
    expect(shape.lengthMeters).toBeCloseTo(1112 + 882, -1);
  });

  it("measures an empty or one-point line as zero meters", () => {
    // Act & Assert
    expect(toPathShape([])).toEqual({ pointCount: 0, lengthMeters: 0 });
    expect(toPathShape([[126.99, 37.58]])).toEqual({ pointCount: 1, lengthMeters: 0 });
  });
});

describe("toPathVersion", () => {
  const fetched = { path: [[126.99, 37.58], [126.99, 37.59]] as Position[], stations: [station] };

  it("is sixteen hex characters, the same for the same content", () => {
    // Act
    const version = toPathVersion(fetched);

    // Assert
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(toPathVersion(structuredClone(fetched))).toBe(version);
  });

  it("changes when a point moves, the order changes, or a station changes", () => {
    // Arrange
    const version = toPathVersion(fetched);

    // Act
    const moved = toPathVersion({ ...fetched, path: [[126.99, 37.58], [126.99, 37.591]] });
    const reversed = toPathVersion({ ...fetched, path: [...fetched.path].reverse() });
    const renamed = toPathVersion({ ...fetched, stations: [{ ...station, stationName: "성균관대" }] });

    // Assert
    expect(new Set([version, moved, reversed, renamed]).size).toBe(4);
  });
});

describe("toPathVersion with directions", () => {
  const fetched = { path: [[126.99, 37.58], [126.99, 37.59]] as Position[], stations: [{ ...station, direction: "이화사거리" }] };

  it("changes when a station's direction changes, appears or goes", () => {
    // Act
    const versions = [fetched, { ...fetched, stations: [{ ...station, direction: "성균관대운동장" }] }, { ...fetched, stations: [{ ...station, direction: null }] }].map(toPathVersion);

    // Assert
    expect(new Set(versions).size).toBe(3);
  });

  // EVIDENCE: jongro_route_paths in production held eb9ffab88fbdad95 for Jongno 07 on 2026-10-23, synced 2026-10-18 from
  // the content of fixtures/jongro-route-paths.json without its directions; every document stored then has no direction.
  it("differs from the version production stored for the same line before directions, with or without them", () => {
    // Arrange
    const line = capturedRoutePathOf("jongro07");
    const withoutDirections = { ...line, stations: line.stations.map(({ direction: _direction, ...rest }) => rest) };
    const noneSent = { ...line, stations: line.stations.map((each) => ({ ...each, direction: null })) };

    // Act
    const versions = [line, noneSent].map(toPathVersion);

    // Assert
    expect(toPathVersion(withoutDirections)).not.toBe("eb9ffab88fbdad95");
    expect(versions).not.toContain("eb9ffab88fbdad95");
  });
});

describe("toPathSyncDecision", () => {
  it("writes nothing when the version is the stored one", () => {
    // Act & Assert
    expect(decide({ pointCount: 1, lengthMeters: 1 }, 0, "old")).toEqual({ kind: "unchanged" });
  });

  it.each([
    [9, { kind: "hold", reason: "tooFewPoints" }],
    [10, { kind: "hold", reason: "pointCountChanged" }],
  ])("holds a line of %i points", (pointCount, expected) => {
    // Act & Assert
    expect(decide({ pointCount, lengthMeters: 5000 })).toEqual(expected);
  });

  it("holds a change with no station", () => {
    // Act & Assert
    expect(decide(STORED, 0)).toEqual({ kind: "hold", reason: "noStations" });
  });

  it.each([
    [129, { kind: "apply" }],
    [130, { kind: "apply" }],
    [131, { kind: "hold", reason: "pointCountChanged" }],
    [71, { kind: "apply" }],
    [70, { kind: "apply" }],
    [69, { kind: "hold", reason: "pointCountChanged" }],
  ])("compares %i points with the stored 100 at a 30%% share", (pointCount, expected) => {
    // Act & Assert
    expect(decide({ pointCount, lengthMeters: 5000 })).toEqual(expected);
  });

  it.each([
    [6450, { kind: "apply" }],
    [6500, { kind: "apply" }],
    [6550, { kind: "hold", reason: "lengthChanged" }],
    [3450, { kind: "hold", reason: "lengthChanged" }],
  ])("compares a %i m line with the stored 5000 m at a 30%% share", (lengthMeters, expected) => {
    // Act & Assert
    expect(decide({ pointCount: 100, lengthMeters })).toEqual(expected);
  });
});

// WHY: with no snapshot, a fresh database stores a route's first line from TOPIS on the absolute checks alone
// (ADR 0012, D3).
describe("toPathSyncDecision with no stored line", () => {
  const decideFirst = (pointCount: number, stationCount = 22) => toPathSyncDecision(null, { pathVersion: "new", shape: { pointCount, lengthMeters: 1 }, stationCount });

  it.each([
    [9, { kind: "hold", reason: "tooFewPoints" }],
    [10, { kind: "apply" }],
    [11, { kind: "apply" }],
    [5000, { kind: "apply" }],
  ])("on a first line of %i points → %j", (pointCount, expected) => {
    // Act & Assert
    expect(decideFirst(pointCount)).toEqual(expected);
  });

  it.each([
    [0, { kind: "hold", reason: "noStations" }],
    [1, { kind: "apply" }],
  ])("on a first line with %i stations → %j", (stationCount, expected) => {
    // Act & Assert
    expect(decideFirst(241, stationCount)).toEqual(expected);
  });
});
