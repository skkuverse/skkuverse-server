/**
 * projectOntoPolyline, a point's place along a polyline: the distance from the
 * first vertex to its foot on the nearest segment, and how far it lies from it.
 */
import { projectOntoPolyline } from "./polyline.util";

// A straight line south along 127.02°E, two segments of 0.01° of latitude: about 1,111.95 m each.
const STEP_M = (6_371_000 * 0.01 * Math.PI) / 180;
const LINE = [
  { lat: 37.5, lng: 127.02 },
  { lat: 37.49, lng: 127.02 },
  { lat: 37.48, lng: 127.02 },
];
// One meter east at 37.49°N, in degrees of longitude.
const EAST_M = 1 / (STEP_M * 100 * Math.cos((37.49 * Math.PI) / 180));

describe("projectOntoPolyline", () => {
  it("puts a vertex at its distance along the line, on it", () => {
    // Act
    const projection = projectOntoPolyline(LINE, { lat: 37.49, lng: 127.02 });

    // Assert
    expect(projection.alongM).toBeCloseTo(STEP_M, 0);
    expect(projection.offsetM).toBeCloseTo(0, 3);
  });

  it("measures a point beside the line by its foot on the nearest segment", () => {
    // Act
    const projection = projectOntoPolyline(LINE, { lat: 37.485, lng: 127.02 + 100 * EAST_M });

    // Assert
    expect(projection.alongM).toBeCloseTo(1.5 * STEP_M, 0);
    expect(projection.offsetM).toBeCloseTo(100, 0);
  });

  it("clamps a point past the last vertex to the line's end", () => {
    // Act
    const projection = projectOntoPolyline(LINE, { lat: 37.479, lng: 127.02 });

    // Assert
    expect(projection.alongM).toBeCloseTo(2 * STEP_M, 0);
    expect(projection.offsetM).toBeCloseTo(STEP_M / 10, 0);
  });
});
