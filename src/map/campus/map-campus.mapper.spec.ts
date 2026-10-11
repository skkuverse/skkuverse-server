/**
 * Campus overlays: a building drawn once per building layer it qualifies for,
 * with its position rebuilt as [lng, lat]; the static fallback with no tap; and
 * a hand-authored shape keeping its kind, its English fallback and its tap.
 */
import type { BuildingDoc, CampusShapeDoc } from "../../building/building.document";
import { FALLBACK_MARKERS } from "./map-campus.constants";
import { toCampusBuildingOverlays, toFallbackOverlays, toShapeOverlay } from "./map-campus.mapper";

function building(over: Record<string, unknown> = {}): BuildingDoc {
  return {
    _id: 2,
    displayNo: "1",
    campus: "hssc",
    name: { ko: "수선관", en: "" },
    location: { type: "Point", coordinates: [126.994479, 37.587361] },
    ...over,
  } as unknown as BuildingDoc;
}

describe("toCampusBuildingOverlays", () => {
  it("draws a building on both layers, the number first, with the English name falling back to Korean", () => {
    // Act
    const overlays = toCampusBuildingOverlays([building()]);

    // Assert
    expect(overlays.map((o) => [o.layerId, o.text])).toEqual([
      ["building_numbers", { ko: "1", en: "1" }],
      ["building_labels", { ko: "수선관", en: "수선관" }],
    ]);
    expect(overlays[0]?.geometry).toEqual({ type: "Point", coordinates: [126.994479, 37.587361] });
  });

  it("leaves a building with no number off the numbers layer, and one with no position off the map", () => {
    // Act
    const overlays = toCampusBuildingOverlays([
      building({ displayNo: null }),
      building({ _id: 3, location: { type: "Point", coordinates: [Number.NaN, 37.5] } }),
    ]);

    // Assert
    expect(overlays.map((o) => [o.id, o.layerId])).toEqual([["2", "building_labels"]]);
  });
});

describe("toFallbackOverlays", () => {
  it("draws every fallback marker on both building layers and offers no tap", () => {
    // Act
    const overlays = toFallbackOverlays();

    // Assert
    expect(overlays).toHaveLength(FALLBACK_MARKERS.length * 2);
    expect(overlays.every((o) => o.tap === null)).toBe(true);
  });
});

describe("toShapeOverlay", () => {
  const shape = (over: Record<string, unknown>): CampusShapeDoc =>
    ({ _id: "s", campus: "nsc", layerId: "campus_geometry", title: { ko: "길", en: "" }, skkuId: null, order: 3, ...over }) as unknown as CampusShapeDoc;

  it("draws a line as a path and a point as an exact marker, with no tap for a backdrop", () => {
    // Act
    const path = toShapeOverlay(shape({ geometry: { type: "LineString", coordinates: [[126.97, 37.29], [126.98, 37.29]] } }));
    const point = toShapeOverlay(shape({ geometry: { type: "Point", coordinates: [126.97, 37.29] }, skkuId: 7 }));

    // Assert
    expect(path).toMatchObject({ kind: "path", text: { ko: "길", en: "길" }, tap: null, order: 3 });
    expect(point).toMatchObject({ kind: "marker", pinPriority: 0, locationAccuracy: "exact", tap: { kind: "skku_building", placeId: "7" } });
  });
});
