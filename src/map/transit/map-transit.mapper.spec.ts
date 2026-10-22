/**
 * The transit overlays: one path per Jongno
 * route, in the order the bus read answers, on the route's own base layer,
 * named in every language, its geometry the stored line exactly as stored
 * (no closing point added, the pair order kept), a backdrop with no tap and
 * the place-only fields stated empty.
 */
import type { RoutePath } from "../../bus/route-path/bus-route-path.types";
import { BASE_LAYERS } from "../map.constants";
import { toTransitOverlays } from "./map-transit.mapper";

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
    const overlays = toTransitOverlays([routePath("jongro02", "02"), routePath("jongro07", "07"), routePath("jongro08", "08")]);

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
