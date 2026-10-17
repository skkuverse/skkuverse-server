/**
 * Integration over BusConfigController (ETag/304 through EtagInterceptor) on
 * the production pipeline (buildTestApp); the config reads no database, so
 * nothing is overridden. Asserts group shape, 404
 * GROUP_NOT_FOUND, 304, per-language ETag difference, and the hssc (11 stations,
 * lastStationIndex 10, refreshInterval 10) / jongro07 (22 stations,
 * refreshInterval 40) screen contents.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { busConfig, busGroup } from "../../../src/bus/config/bus-config.wire";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({ imports: [BusStopsModule, BusConfigModule], role: "api" });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe("GET /bus/config", () => {
  it("returns a groups array of 7", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config");

    // Assert
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.groups)).toBe(true);
    expect(res.body.data.groups).toHaveLength(7);
    expect(res.headers.etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("returns 304 when If-None-Match matches (root)", async () => {
    // Arrange
    const first = await request(httpServer).get("/bus/config");
    const etag = first.headers.etag;

    // Act
    const second = await request(httpServer).get("/bus/config").set("If-None-Match", etag);

    // Assert
    expect(second.status).toBe(304);
    expect(second.headers["x-response-time"]).toBeUndefined();
  });
});

describe("GET /bus/config/:groupId", () => {
  it("returns group shape for known id", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/campus");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("id", "campus");
    expect(res.body.data).toHaveProperty("screenType", "schedule");
    expect(res.body.data).toHaveProperty("label");
    expect(res.body.data).toHaveProperty("visibility");
    expect(res.body.data).toHaveProperty("card");
    expect(res.body.data).toHaveProperty("screen");
  });

  it("returns 404 for unknown groupId", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/unknown");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 404 GROUP_NOT_FOUND even with If-None-Match (precedes 304)", async () => {
    // Act
    const res = await request(httpServer)
      .get("/bus/config/unknown")
      .set("If-None-Match", '"anything"');

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });

  it("returns 304 when ETag matches", async () => {
    // Arrange
    const first = await request(httpServer).get("/bus/config/campus");

    // Act
    const etag = first.headers.etag;

    // Assert
    expect(etag).toBeDefined();
    const second = await request(httpServer)
      .get("/bus/config/campus")
      .set("If-None-Match", etag);
    expect(second.status).toBe(304);
  });

  it("returns different ETag per language", async () => {
    // Arrange
    const ko = await request(httpServer).get("/bus/config/campus");

    // Act
    const en = await request(httpServer)
      .get("/bus/config/campus")
      .set("Accept-Language", "en");

    // Assert
    expect(ko.headers.etag).toBeDefined();
    expect(en.headers.etag).toBeDefined();
    expect(ko.headers.etag).not.toBe(en.headers.etag);
  });

  it("commute serves the spec's group config", async () => {
    // Act
    const res = await request(httpServer).get("/bus/config/commute");

    // Assert
    expect(res.status).toBe(200);
    const group = res.body.data;
    expect(group.screenType).toBe("schedule");
    expect(group.screen.services.map((s: { serviceId: string }) => s.serviceId)).toEqual([
      "commute-jeongja",
      "commute-jamsil",
      "commute-dogok",
      "commute-gangnam-yangjae",
      "commute-gwanggyo",
    ]);
    expect(group.screen.defaultServiceId).toBe("commute-jeongja");
    expect(group.screen.serviceSelector).toBe("chips");
    expect(group.screen).not.toHaveProperty("showBusCount");
    expect(group.screen.features).toEqual([{ type: "info", url: "https://webview.skkuverse.com/bus/commute/info" }]);
  });

  it("campus screen has services[] and routeBadges", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/campus");

    // Act
    const screen = res.body.data.screen;

    // Assert
    expect(Array.isArray(screen.services)).toBe(true);
    expect(screen.services.length).toBeGreaterThan(0);
    expect(Array.isArray(screen.routeBadges)).toBe(true);
    expect(screen.routeBadges.length).toBeGreaterThan(0);
  });

  it("hssc screen has dataEndpoint, refreshInterval, stations, routeOverlay", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/hssc");

    // Act
    const screen = res.body.data.screen;

    // Assert
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/hssc");
    expect(screen.refreshInterval).toBe(10);
    expect(screen.lastStationIndex).toBe(10);
    expect(Array.isArray(screen.stations)).toBe(true);
    expect(screen.stations).toHaveLength(11);
    expect(screen.stations[0]).toHaveProperty("index", 0);
    expect(screen.stations[0]).toHaveProperty("name");
    expect(screen.routeOverlay).toBeNull();
  });

  it("jongro07 screen has stations and routeOverlay", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/jongro07");

    // Act
    const screen = res.body.data.screen;

    // Assert
    expect(screen.dataEndpoint).toBe("/bus/realtime/data/jongro07");
    expect(screen.refreshInterval).toBe(40);
    expect(screen.stations).toHaveLength(22);
    expect(screen.lastStationIndex).toBe(21);
    expect(screen.routeOverlay).toBeNull();
  });

  it("jongro08 has its label, subtitle and 31-stop screen", async () => {
    // Arrange
    const res = await request(httpServer).get("/bus/config/jongro08");

    // Act
    const g = res.body.data;

    // Assert
    expect(g.label).toBe("종로 08");
    expect(g.card.subtitle).toBe("명륜3가 ↔ 종로5가");
    expect(g.screen.dataEndpoint).toBe("/bus/realtime/data/jongro08");
    expect(g.screen.stations).toHaveLength(31);
    expect(g.screen.lastStationIndex).toBe(30);
  });
});

// WHY: a group id is a lookup key, so a name Object.prototype already has must miss like any other
// unknown id (spencer0124/skkuverse#82).
describe("GET /bus/config/:groupId with an Object.prototype name", () => {
  it.each(["toString", "__proto__", "constructor", "hasOwnProperty"])("%s → 404 GROUP_NOT_FOUND", async (groupId) => {
    // Act
    const res = await request(httpServer).get(`/bus/config/${groupId}`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "GROUP_NOT_FOUND", message: `Unknown groupId: ${groupId}` });
  });
});

describe("GET /bus/config and /bus/config/:groupId bodies", () => {
  it.each(["ko", "en"])("parse with their published wire schemas for every group in %s", async (lang) => {
    // Act
    const config = await request(httpServer).get("/bus/config").set("Accept-Language", lang);
    const ids: string[] = config.body.data.groups.map((group: { id: string }) => group.id);
    const groups = await Promise.all(ids.map((id) => request(httpServer).get(`/bus/config/${id}`).set("Accept-Language", lang)));

    // Assert
    expect(config.status).toBe(200);
    expectWire(busConfig, config.body.data);
    expect(groups.map((res) => res.status)).toEqual(ids.map(() => 200));
    for (const res of groups) expectWire(busGroup, res.body.data);
  });
});

describe("GET /bus/config/:groupId refresh", () => {
  it("offers a traffic refresh on each campus service, and none on fasttrack", async () => {
    // Act
    const campus = await request(httpServer).get("/bus/config/campus");
    const fasttrack = await request(httpServer).get("/bus/config/fasttrack");

    // Assert
    expect(campus.status).toBe(200);
    expectWire(busGroup, campus.body.data);
    for (const service of campus.body.data.screen.services) expect(service.refresh).toEqual({ targets: ["traffic"], intervalSec: 60 });
    expect(fasttrack.status).toBe(200);
    expectWire(busGroup, fasttrack.body.data);
    expect(fasttrack.body.data.screen.services[0]).not.toHaveProperty("refresh");
  });
});
