/**
 * BusRouteOverlayService — the routes map. Both jongro routes use color "4CAF50" with their respective coords; unknown
 * id → undefined (the controller turns that into 404 NOT_FOUND).
 */

import { JONGRO02_COORDS as jongro02Coords, JONGRO07_COORDS as jongro07Coords } from "./bus-route-overlay.constants";
import { BusRouteOverlayService } from "./bus-route-overlay.service";

let service: BusRouteOverlayService;

beforeEach(() => {
  service = new BusRouteOverlayService();
});

describe("BusRouteOverlayService.getRoute", () => {
  it("returns jongro07 overlay with color 4CAF50 and its coords", () => {
    // Act
    const r = service.getRoute("jongro07");

    // Assert
    expect(r).toBeDefined();
    expect(r!.color).toBe("4CAF50");
    expect(r!.coords).toBe(jongro07Coords);
  });

  it("returns jongro02 overlay with color 4CAF50 and its coords", () => {
    // Act
    const r = service.getRoute("jongro02");

    // Assert
    expect(r).toBeDefined();
    expect(r!.color).toBe("4CAF50");
    expect(r!.coords).toBe(jongro02Coords);
  });

  it("returns undefined for an unknown routeId", () => {
    // Act & Assert
    expect(service.getRoute("nope")).toBeUndefined();
  });
});
