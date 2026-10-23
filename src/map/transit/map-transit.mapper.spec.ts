/**
 * The transit overlays: one path per Jongno
 * route, in the order the bus read answers, on the route's own base layer,
 * named in every language, its geometry the stored line exactly as stored
 * (no closing point added, the pair order kept), a backdrop with no tap and
 * the place-only fields stated empty; and the HSSC shuttle's loop, measured
 * from GPS and stored in the `hssc-route-line` dataset, as one more path on its
 * own layer, named as /bus/config names the line.
 */
import type { RoutePath } from "../../bus/route-path/bus-route-path.types";
import { BASE_LAYERS } from "../map.constants";
import { toHsscRouteOverlay, toTransitOverlays } from "./map-transit.mapper";

const routePath = (routeId: string, code: string): RoutePath => ({
  routeId,
  code,
  path: [
    [126.9921543446, 37.5881571127],
    [126.9921650734, 37.5881358585],
    [126.9935944522, 37.587782602],
  ],
  stations: [{ topisId: "100900220", arsId: "01617", stationName: "성균관대운동장", sequence: 1, lng: 126.99237, lat: 37.587863, isTurnaround: false }],
});

// A closed loop of four points, as the dataset stores it: the last repeats the first.
const HSSC_LOOP: Array<[number, number]> = [
  [126.992374, 37.587807],
  [126.992364, 37.587665],
  [126.992418, 37.58753],
  [126.992374, 37.587807],
];

describe("toTransitOverlays", () => {
  it("draws one path per route in the order given, on the route's layer, named in every language", () => {
    // Act
    const overlays = toTransitOverlays([routePath("jongro02", "02"), routePath("jongro07", "07"), routePath("jongro08", "08")]);

    // Assert
    expect(overlays.map((o) => [o.kind, o.id, o.layerId, o.order])).toEqual([
      ["path", "jongro02", "jongro02_route", 0],
      ["path", "jongro07", "jongro07_route", 1],
      ["path", "jongro08", "jongro08_route", 2],
    ]);
    expect(overlays[1]).toEqual({
      kind: "path",
      id: "jongro07",
      layerId: "jongro07_route",
      campus: "hssc",
      text: { ko: "종로07", en: "Jongno 07", zh: "钟路07" },
      subtitle: null,
      hours: [],
      fields: [],
      actions: [],
      order: 1,
      facets: {},
      orderByOption: {},
      tap: null,
      geometry: { type: "LineString", coordinates: routePath("jongro07", "07").path },
    });
  });

  it("serves every overlay on a base layer that names the transit endpoint", () => {
    // Arrange
    const transitLayerIds = new Set<string>(BASE_LAYERS.filter((l) => l.endpoint === "/map/overlays/transit").map((l) => l.id));

    // Act
    const overlays = [...toTransitOverlays([routePath("jongro02", "02"), routePath("jongro07", "07"), routePath("jongro08", "08")]), toHsscRouteOverlay(HSSC_LOOP, 3)];

    // Assert
    expect(overlays.map((o) => o.layerId).every((id) => transitLayerIds.has(id))).toBe(true);
    expect(transitLayerIds.size).toBe(overlays.length);
  });

  it("keeps an open loop open: no closing position is added", () => {
    // Arrange
    const line = routePath("jongro07", "07");

    // Act
    const [overlay] = toTransitOverlays([line]);

    // Assert
    expect(overlay!.geometry.coordinates).toHaveLength(3);
    expect(overlay!.geometry.coordinates.at(-1)).toEqual([126.9935944522, 37.587782602]);
  });
});

describe("toHsscRouteOverlay", () => {
  it("draws the HSSC loop as one path on the hssc_route layer, named in every language as /bus/config names the line", () => {
    // Act
    const overlay = toHsscRouteOverlay(HSSC_LOOP, 3);

    // Assert
    expect(overlay).toEqual({
      kind: "path",
      id: "hssc",
      layerId: "hssc_route",
      campus: "hssc",
      text: { ko: "인사캠 셔틀버스", en: "HSSC Shuttle Bus", zh: "人文校区班车" },
      subtitle: null,
      hours: [],
      fields: [],
      actions: [],
      order: 3,
      facets: {},
      orderByOption: {},
      tap: null,
      geometry: { type: "LineString", coordinates: HSSC_LOOP },
    });
  });

  it("serves the stored loop as stored: closed, every position in order", () => {
    // Act
    const overlay = toHsscRouteOverlay(HSSC_LOOP, 0);

    // Assert
    expect(overlay.geometry.coordinates).toHaveLength(4);
    expect(overlay.geometry.coordinates.at(-1)).toEqual(overlay.geometry.coordinates[0]);
  });
});
