/**
 * The route path rules (add-jongro-route-lines D2, D3): a line's length in
 * meters over its points, a version that changes with any point or station,
 * and the sync decision: unchanged content writes nothing, and a line of too
 * few points, no station, or a point count or length more than 30% off the
 * stored line is held, each at its threshold.
 */
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
