/**
 * Ring winding and closure — the one guarantee Mongo does NOT give us.
 *
 * The 2dsphere index rejects an unclosed or self-intersecting ring at insert,
 * so closure is belt-and-braces here. Winding is not checked by Mongo at all:
 * a reversed exterior ring stores silently, and RFC 7946 §3.1.6 requires
 * exterior rings counter-clockwise and holes clockwise. Getting it wrong is
 * invisible on this side and, on the client, makes Naver "draw abnormally or
 * not receive events" — a polygon that is there but cannot be tapped.
 *
 * Every position below is [lng, lat], GeoJSON order, around 자과캠.
 */
import {
  closeRing,
  toWirePolygon,
  isClosedRing,
  rewindPolygon,
  rewindRing,
  signedArea,
} from "./ring-winding.util";
import type { LinearRing } from "./geojson.types";

// Counter-clockwise in [lng, lat] — the RFC 7946 exterior direction.
const CCW: LinearRing = [
  [126.97, 37.29],
  [126.972, 37.29],
  [126.972, 37.292],
  [126.97, 37.292],
  [126.97, 37.29],
];
const CW: LinearRing = [...CCW].reverse();

describe("signedArea", () => {
  it("is positive for a counter-clockwise ring", () => {
    // Act & Assert
    expect(signedArea(CCW)).toBeGreaterThan(0);
  });

  it("is negative for a clockwise ring", () => {
    // Act & Assert
    expect(signedArea(CW)).toBeLessThan(0);
  });

  it("is zero for a degenerate ring rather than throwing", () => {
    // Act & Assert
    expect(signedArea([[126.97, 37.29], [126.97, 37.29]])).toBe(0);
    expect(signedArea([])).toBe(0);
  });
});

describe("isClosedRing", () => {
  it("is true when the last position repeats the first", () => {
    // Act & Assert
    expect(isClosedRing(CCW)).toBe(true);
  });

  it("is false when it does not", () => {
    // Act & Assert
    expect(isClosedRing(CCW.slice(0, -1))).toBe(false);
  });

  it("is false for a ring too short to close", () => {
    // Act & Assert
    expect(isClosedRing([])).toBe(false);
    expect(isClosedRing([[126.97, 37.29]])).toBe(false);
  });
});

describe("closeRing", () => {
  it("appends the first position when the ring is open", () => {
    // Arrange
    const open = CCW.slice(0, -1);

    // Act
    const closed = closeRing(open);

    // Assert
    expect(closed).toHaveLength(open.length + 1);
    expect(closed[closed.length - 1]).toEqual(closed[0]);
  });

  it("leaves an already closed ring untouched", () => {
    // Act & Assert
    expect(closeRing(CCW)).toEqual(CCW);
  });

  it("leaves a ring too short to close alone", () => {
    // Act & Assert
    expect(closeRing([])).toEqual([]);
  });
});

describe("rewindRing", () => {
  it("reverses a clockwise ring when counter-clockwise is asked for", () => {
    // Act & Assert
    expect(rewindRing(CW, "ccw")).toEqual(CCW);
  });

  it("reverses a counter-clockwise ring when clockwise is asked for", () => {
    // Act & Assert
    expect(rewindRing(CCW, "cw")).toEqual(CW);
  });

  it("leaves a ring already wound the requested way untouched", () => {
    // Act & Assert
    expect(rewindRing(CCW, "ccw")).toEqual(CCW);
    expect(rewindRing(CW, "cw")).toEqual(CW);
  });

  it("closes an open ring on the way through", () => {
    // Act & Assert
    expect(isClosedRing(rewindRing(CCW.slice(0, -1), "ccw"))).toBe(true);
  });

  it("does not reverse a degenerate ring, whose area is zero either way", () => {
    // Arrange
    const degenerate: LinearRing = [[126.97, 37.29], [126.97, 37.29]];

    // Act & Assert
    expect(rewindRing(degenerate, "ccw")).toEqual(degenerate);
  });
});

describe("rewindPolygon", () => {
  it("makes the exterior counter-clockwise and every hole clockwise", () => {
    // Arrange
    const hole: LinearRing = [
      [126.9705, 37.2905],
      [126.9715, 37.2905],
      [126.9715, 37.2915],
      [126.9705, 37.2915],
      [126.9705, 37.2905],
    ];

    // Act
    // Deliberately the wrong way round on both rings.
    const [outer, inner] = rewindPolygon([CW, hole]);

    // Assert
    expect(signedArea(outer!)).toBeGreaterThan(0);
    expect(signedArea(inner!)).toBeLessThan(0);
  });

  it("leaves a conformant polygon byte-identical", () => {
    // Arrange
    const conformant = [CCW, [...CCW].reverse()];

    // Act & Assert
    expect(rewindPolygon(conformant)).toEqual(conformant);
  });

  it("handles a polygon with no holes", () => {
    // Act & Assert
    expect(rewindPolygon([CCW])).toEqual([CCW]);
  });
});

describe("toWirePolygon", () => {
  it("returns the SAME object when the polygon is already conformant", () => {
    // Arrange
    // Identity, not equality. A correctly authored polygon must still reach the
    // response by reference, so the no-conversion property this schema is built
    // on holds for every geometry that was authored right.
    const geometry = { type: "Polygon" as const, coordinates: [CCW] };

    // Act & Assert
    expect(toWirePolygon(geometry)).toBe(geometry);
  });

  it("rewinds a stored clockwise exterior for the wire", () => {
    // Arrange
    const geometry = { type: "Polygon" as const, coordinates: [CW] };

    // Act
    const wire = toWirePolygon(geometry);

    // Assert
    expect(wire).not.toBe(geometry);
    expect(wire.coordinates[0]).toEqual(CCW);
    // Mongo stores a reversed ring without complaint — its 2dsphere index
    // checks closure and self-intersection, never orientation — so this is the
    // only thing standing between an ops edit and a zone that draws but cannot
    // be tapped.
    expect(signedArea(wire.coordinates[0]!)).toBeGreaterThan(0);
  });

  it("leaves the [lng, lat] inside every position alone", () => {
    // Act
    // The whole no-swap argument rests on this: rewinding reorders ring
    // ELEMENTS and never touches a position's contents.
    const wire = toWirePolygon({ type: "Polygon", coordinates: [CW] });

    // Assert
    for (const [lng, lat] of wire.coordinates[0]!) {
      expect(lng).toBeGreaterThan(124);
      expect(lat).toBeLessThan(39);
    }
  });
});
