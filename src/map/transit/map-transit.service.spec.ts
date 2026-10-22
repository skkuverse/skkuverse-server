/**
 * MapTransitService over a scripted bus route path read
 * (ADR 0012, D3): the stored lines become one path
 * overlay each, and a read that left out a route with no stored line is
 * marked degraded, so the controller lets a shared cache keep it a minute
 * only.
 */
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BusRoutePathService } from "../../bus/route-path/bus-route-path.service";
import type { RoutePath } from "../../bus/route-path/bus-route-path.types";
import { MapTransitService } from "./map-transit.service";

const line = (routeId: string, code: string): RoutePath => ({ routeId, code, path: [[126.99, 37.58], [126.991, 37.581]], stations: [] });

let routePaths: FakeBusRoutePathService;
let service: MapTransitService;

beforeEach(() => {
  routePaths = new FakeBusRoutePathService();
  service = new MapTransitService(asReal<BusRoutePathService>(routePaths));
});

describe("MapTransitService.getTransitOverlays", () => {
  it("draws each stored line as a path overlay, not degraded", async () => {
    // Arrange
    routePaths.routePaths = { routePaths: [line("jongro02", "02"), line("jongro07", "07")], hasMissingRoutes: false };

    // Act
    const { overlays, degraded } = await service.getTransitOverlays();

    // Assert
    expect(degraded).toBe(false);
    expect(overlays.map((o) => [o.kind, o.layerId, o.text.ko])).toEqual([
      ["path", "jongro02_route", "종로02"],
      ["path", "jongro07_route", "종로07"],
    ]);
  });

  it("marks an answer with a missing route degraded and still draws the stored ones", async () => {
    // Arrange
    routePaths.routePaths = { routePaths: [line("jongro07", "07")], hasMissingRoutes: true };

    // Act
    const { overlays, degraded } = await service.getTransitOverlays();

    // Assert
    expect(degraded).toBe(true);
    expect(overlays).toHaveLength(1);
  });
});
