/**
 * Integration over BusRouteOverlayController (GET /bus/route/:routeId) on the
 * production pipeline (buildTestApp), and the route that replaced it on the
 * campus screen being gone.
 *
 * BusRouteOverlayService uses the real static routes map. Asserts the route
 * overlay payload, 404 NOT_FOUND for an unknown route with the exact message,
 * the global filter's generic 500 for an unexpected throw, and that the retired
 * GET /bus/campus/eta answers 404 (not retried by the app) rather than 500.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusRouteOverlayModule } from "../../../src/bus/route-overlay/bus-route-overlay.module";
import { BusRouteOverlayService } from "../../../src/bus/route-overlay/bus-route-overlay.service";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({ imports: [BusModule, BusRouteOverlayModule], role: "api" });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /bus/route/:routeId", () => {
  it("jongro07 → { color, coords }", async () => {
    // Act
    const res = await request(httpServer).get("/bus/route/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe("4CAF50");
    expect(res.body.data).toHaveProperty("coords");
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("jongro02 → { color, coords }", async () => {
    // Act
    const res = await request(httpServer).get("/bus/route/jongro02");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBe("4CAF50");
  });

  it("unknown routeId → 404 NOT_FOUND with exact message", async () => {
    // Act
    const res = await request(httpServer).get("/bus/route/nope");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.message).toBe("Route 'nope' not found");
  });

  it("an unexpected throw → 500 INTERNAL_ERROR (no X-Response-Time)", async () => {
    // Arrange
    jest.spyOn(app.get(BusRouteOverlayService), "getRoute").mockImplementation(() => {
      throw new Error("boom");
    });

    // Act
    const res = await request(httpServer).get("/bus/route/jongro07");

    // Assert
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body.error.message).toBe("Internal server error");
    // HttpExceptionFilter omits X-Response-Time on this unknown-error 500
    // branch.
    expect(res.headers["x-response-time"]).toBeUndefined();
  });
});

describe("GET /bus/campus/eta (retired)", () => {
  it("is gone: 404, which the app does not retry", async () => {
    // Act
    const res = await request(httpServer).get("/bus/campus/eta");

    // Assert
    expect(res.status).toBe(404);
  });
});

// WHY: a route id is a lookup key, so a name Object.prototype already has must miss like any other
// unknown id (spencer0124/skkuverse#82).
describe("GET /bus/route/:routeId with an Object.prototype name", () => {
  it.each(["toString", "__proto__", "constructor", "hasOwnProperty"])("%s → 404 NOT_FOUND", async (routeId) => {
    // Act
    const res = await request(httpServer).get(`/bus/route/${routeId}`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "NOT_FOUND", message: `Route '${routeId}' not found` });
  });
});
