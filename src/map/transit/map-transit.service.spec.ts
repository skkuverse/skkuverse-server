/**
 * MapTransitService over a scripted bus route path read
 * (ADR 0012, D3): the stored lines become one path
 * overlay each, and a read that left out a route with no stored line is
 * marked degraded, so the controller lets a shared cache keep it a minute
 * only. The HSSC loop (the `hssc-route-line` dataset) is drawn after the
 * Jongno lines, which it leaves as they are; with none ever read the Jongno
 * lines serve without it, degraded (ADR 0013, D6).
 */
import { FakeBusHsscRouteLineService } from "../../../__tests__/helpers/fakes/bus/bus-hssc-route-line.service.fake";
import { FakeBusRoutePathService } from "../../../__tests__/helpers/fakes/bus/bus-route-path.service.fake";
import { asReal } from "../../../__tests__/helpers/fakes/public-of";
import type { BusHsscRouteLineService } from "../../bus/hssc-route-line/bus-hssc-route-line.service";
import type { BusRoutePathService } from "../../bus/route-path/bus-route-path.service";
import type { RoutePath } from "../../bus/route-path/bus-route-path.types";
import { MapTransitService } from "./map-transit.service";

const line = (routeId: string, code: string): RoutePath => ({ routeId, code, path: [[126.99, 37.58], [126.991, 37.581]], stations: [] });

const HSSC_LOOP: Array<[number, number]> = [[126.992374, 37.587807], [126.992364, 37.587665], [126.992374, 37.587807]];

let routePaths: FakeBusRoutePathService;
let hsscRouteLine: FakeBusHsscRouteLineService;
let service: MapTransitService;

beforeEach(() => {
  routePaths = new FakeBusRoutePathService();
  hsscRouteLine = new FakeBusHsscRouteLineService();
  hsscRouteLine.routeLine = { revision: 1, path: HSSC_LOOP };
  service = new MapTransitService(asReal<BusRoutePathService>(routePaths), asReal<BusHsscRouteLineService>(hsscRouteLine));
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
      ["path", "hssc_route", "인사캠 셔틀버스"],
    ]);
  });

  it("marks an answer with a missing route degraded and still draws the stored ones", async () => {
    // Arrange
    routePaths.routePaths = { routePaths: [line("jongro07", "07")], hasMissingRoutes: true };

    // Act
    const { overlays, degraded } = await service.getTransitOverlays();

    // Assert
    expect(degraded).toBe(true);
    expect(overlays).toHaveLength(2);
  });
});

describe("MapTransitService.getTransitOverlays with the HSSC loop", () => {
  it("draws the HSSC loop after the Jongno lines, which it leaves as they are, not degraded", async () => {
    // Arrange
    routePaths.routePaths = { routePaths: [line("jongro02", "02"), line("jongro07", "07"), line("jongro08", "08")], hasMissingRoutes: false };

    // Act
    const { overlays, degraded } = await service.getTransitOverlays();

    // Assert
    expect(degraded).toBe(false);
    expect(overlays.map((o) => [o.id, o.layerId, o.order])).toEqual([
      ["jongro02", "jongro02_route", 0],
      ["jongro07", "jongro07_route", 1],
      ["jongro08", "jongro08_route", 2],
      ["hssc", "hssc_route", 3],
    ]);
    expect(overlays[3]!.geometry.coordinates).toEqual(HSSC_LOOP);
  });

  it("serves the Jongno lines without the HSSC loop when none was ever read, degraded", async () => {
    // Arrange
    routePaths.routePaths = { routePaths: [line("jongro02", "02"), line("jongro07", "07")], hasMissingRoutes: false };
    hsscRouteLine.routeLine = null;

    // Act
    const { overlays, degraded } = await service.getTransitOverlays();

    // Assert
    expect(degraded).toBe(true);
    expect(overlays.map((o) => o.id)).toEqual(["jongro02", "jongro07"]);
  });
});
