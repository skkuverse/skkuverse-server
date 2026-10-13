/**
 * isDrawableGeometry, the structural check a stored geometry passes before it
 * is served or parsed (building.schema.ts, the map overlay reads). What it
 * guards: only an object whose `type` is exactly Point, LineString or Polygon
 * passes; a position is an array of at least two finite numbers, so an
 * altitude rides along and a numeric string, NaN or Infinity does not; a line
 * needs two positions; a polygon needs at least one ring, and every ring,
 * holes included, needs four positions, the minimum that closes a triangle.
 * Anything else answers false instead of throwing.
 *
 * Every position is [lng, lat], GeoJSON order, around NSC.
 */
import { isDrawableGeometry } from "./geojson.util";

const A = [126.97, 37.29];
const B = [126.972, 37.29];
const C = [126.972, 37.292];
const TRIANGLE = [A, B, C, A];
const HOLE = [
  [126.9705, 37.2905],
  [126.9715, 37.2905],
  [126.9715, 37.2915],
  [126.9705, 37.2905],
];

describe("isDrawableGeometry accepts", () => {
  it.each([
    ["a Point", { type: "Point", coordinates: A }],
    ["a Point with an altitude", { type: "Point", coordinates: [...A, 42] }],
    ["a LineString of two positions", { type: "LineString", coordinates: [A, B] }],
    ["a Polygon whose one ring has four positions", { type: "Polygon", coordinates: [TRIANGLE] }],
    ["a Polygon with a hole of four positions", { type: "Polygon", coordinates: [TRIANGLE, HOLE] }],
    ["a geometry with keys it does not read", { type: "Point", coordinates: A, bbox: [0, 0, 1, 1] }],
  ])("%s", (_case, geometry) => {
    // Act & Assert
    expect(isDrawableGeometry(geometry)).toBe(true);
  });
});

describe("isDrawableGeometry rejects a value that is not a geometry object", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "Point"],
    ["a number", 1],
    ["an array", [A]],
    ["an object without a type", { coordinates: A }],
    ["a type in another case", { type: "point", coordinates: A }],
    ["a type it does not draw", { type: "MultiPoint", coordinates: [A, B] }],
    ["a Point without coordinates", { type: "Point" }],
  ])("%s", (_case, value) => {
    // Act & Assert
    expect(isDrawableGeometry(value)).toBe(false);
  });
});

describe("isDrawableGeometry rejects a Point whose position is not two finite numbers", () => {
  it.each([
    ["one number", [126.97]],
    ["an empty array", []],
    ["numeric strings", ["126.97", "37.29"]],
    ["a NaN longitude", [Number.NaN, 37.29]],
    ["an infinite latitude", [126.97, Number.POSITIVE_INFINITY]],
    ["a null latitude", [126.97, null]],
    ["an array-like object", { 0: 126.97, 1: 37.29, length: 2 }],
    ["a nested position", [A]],
  ])("%s", (_case, coordinates) => {
    // Act & Assert
    expect(isDrawableGeometry({ type: "Point", coordinates })).toBe(false);
  });
});

describe("isDrawableGeometry rejects a LineString", () => {
  it.each([
    ["of one position", [A]],
    ["of no position", []],
    ["with one bad position among good ones", [A, B, [126.97]]],
    ["whose coordinates are a single position", A],
    ["whose coordinates are [null]", [null]],
  ])("%s", (_case, coordinates) => {
    // Act & Assert
    expect(isDrawableGeometry({ type: "LineString", coordinates })).toBe(false);
  });
});

describe("isDrawableGeometry rejects a Polygon", () => {
  it.each([
    ["with no ring", []],
    ["whose ring has three positions", [[A, B, C]]],
    ["whose hole has three positions", [TRIANGLE, HOLE.slice(1)]],
    ["whose ring holds a bad position", [[A, B, [126.972], A]]],
    ["whose coordinates are one ring, a level too shallow", TRIANGLE],
    ["whose coordinates are [null]", [null]],
  ])("%s", (_case, coordinates) => {
    // Act & Assert
    expect(isDrawableGeometry({ type: "Polygon", coordinates })).toBe(false);
  });
});
