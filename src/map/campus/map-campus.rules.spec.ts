/**
 * Which hand-authored campus shapes are drawn (a known base layer, a
 * structurally drawable geometry, a Korean title), and which buildings have a
 * position worth sending.
 */
import type { CampusShapeDoc } from "../../building/building.document";
import { hasFinitePosition, shapeSkipReason } from "./map-campus.rules";

const RING: [number, number][] = [
  [126.9704, 37.2901],
  [126.9714, 37.2901],
  [126.9714, 37.2911],
  [126.9704, 37.2901],
];

function shape(over: Partial<CampusShapeDoc> = {}): CampusShapeDoc {
  return {
    _id: "fp",
    campus: "nsc",
    layerId: "campus_geometry",
    geometry: { type: "Polygon", coordinates: [RING] },
    title: { ko: "외곽", en: "" },
    skkuId: null,
    order: 0,
    ...over,
  } as CampusShapeDoc;
}

describe("shapeSkipReason", () => {
  it("draws a shape on a base layer with a drawable ring and a Korean title", () => {
    // Act & Assert
    expect(shapeSkipReason(shape())).toBeNull();
  });

  it.each([
    [{ layerId: "nope" }, 'fp: layerId "nope" names no base layer'],
    [{ geometry: { type: "Polygon", coordinates: [RING.slice(0, 3)] } }, "fp: geometry is not drawable, or the Korean title is blank"],
    [{ title: { ko: "", en: "Outline" } }, "fp: geometry is not drawable, or the Korean title is blank"],
  ] as Array<[Partial<CampusShapeDoc>, string]>)("skips %j", (over, reason) => {
    // Act & Assert
    expect(shapeSkipReason(shape(over))).toBe(reason);
  });
});

describe("hasFinitePosition", () => {
  it.each([
    [[126.99, 37.58], true],
    [[Number.NaN, 37.58], false],
    [[126.99, Number.NaN], false],
  ])("treats %j as a position: %s", (pair, expected) => {
    // Act & Assert
    expect(hasFinitePosition(pair)).toBe(expected);
  });
});
