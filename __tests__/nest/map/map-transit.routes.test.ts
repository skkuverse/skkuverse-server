/**
 * GET /map/overlays/transit and the route layers of GET /map/config through
 * the production pipeline (buildTestApp), the real bus route path service
 * and the map controllers, over an in-memory `jongro_route_paths` holding the
 * lines stored on 2026-10-18 (ADR 0012, D3). What it guards: the three Jongno lines as path overlays on the map
 * overlay wire, read from the store, shared-cacheable for an hour with no
 * `meta.lang` and every language in the body; a route with no stored line
 * left out, cached a minute; a 503 with an error body when the store cannot be
 * read and nothing is cached; the three opt-in layers in /map/config, all in the map's one
 * route-line green with a dark edge, whatever a route's stored card color, 08 listed before 07 so 07 draws on top
 * where the two share a road; the HSSC shuttle's loop from the `hssc-route-line`
 * dataset as one more path on its own opt-in layer in SKKU green, drawn last, and
 * the Jongno lines served without it, cached a minute and without waiting,
 * while no line was ever read or the read fails (ADR 0013, D6); and the route spending the
 * general rate-limit class once per request (RATE_LIMIT_POLICY faked to count).
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { JONGRO_ROUTES } from "../../../src/bus/bus.constants";
import { BusHsscRouteLineModule } from "../../../src/bus/hssc-route-line/bus-hssc-route-line.module";
import { BusHsscRouteLineRepository } from "../../../src/bus/hssc-route-line/bus-hssc-route-line.repository";
import { BusRoutePathClient } from "../../../src/bus/route-path/bus-route-path.client";
import { BusRoutePathModule } from "../../../src/bus/route-path/bus-route-path.module";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { Clock } from "../../../src/infra/clock";
import { MapConfigModule } from "../../../src/map/config/map-config.module";
import { mapConfig } from "../../../src/map/config/map-config.wire";
import { MapLayerSetModule } from "../../../src/map/layer-set/map-layer-set.module";
import { MapModule } from "../../../src/map/map.module";
import { MapRepository } from "../../../src/map/map.repository";
import { mapOverlays } from "../../../src/map/map.wire";
import { MapTransitModule } from "../../../src/map/transit/map-transit.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { hsscRouteLineFixture, storedHsscRouteLineRepository } from "../../helpers/bus/hssc-route-line";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusHsscRouteLineRepository } from "../../helpers/fakes/bus/bus-hssc-route-line.repository.fake";
import { FakeBusRoutePathClient } from "../../helpers/fakes/bus/bus-route-path.client.fake";
import { FakeBusRoutePathRepository } from "../../helpers/fakes/bus/bus-route-path.repository.fake";
import { FakeMapRepository } from "../../helpers/fakes/map/map.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

// WHY: one fixed instant, so a synced `syncedAt` does not depend on the day the suite runs.
const CLOCK: Clock = { now: () => new Date("2026-10-18T03:00:00.000Z") };
const CLIENT_IP = "203.0.113.7";

interface Overlay {
  kind: string;
  id: string;
  layerId: string;
  text: Record<string, string>;
  geometry: { type: string; coordinates: number[][] };
}

const rateLimitPolicy = new FakeRateLimitPolicy();

async function bootWith(routePaths: FakeBusRoutePathRepository, hsscRouteLine = storedHsscRouteLineRepository()): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: [SchedulingModule, BusRoutePathModule, BusHsscRouteLineModule, MapModule, MapLayerSetModule, MapConfigModule, MapTransitModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: rateLimitPolicy },
      { provide: BusRoutePathRepository, useValue: routePaths },
      { provide: BusHsscRouteLineRepository, useValue: hsscRouteLine },
      { provide: BusRoutePathClient, useValue: new FakeBusRoutePathClient() },
      { provide: MapRepository, useValue: new FakeMapRepository() },
      { provide: Clock, useValue: CLOCK },
    ],
    role: "api",
  });
}

describe("GET /map/overlays/transit from the stored lines", () => {
  let app: NestExpressApplication;
  let httpServer: import("http").Server;
  const routePaths = storedBusRoutePathRepository();

  beforeAll(async () => {
    app = await bootWith(routePaths);
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves one path per Jongno route from jongro_route_paths, shared-cacheable for an hour", async () => {
    // Arrange
    const stored07 = routePaths.routePaths.get("jongro07")!;
    stored07.path = stored07.path.slice(0, 200);

    // Act
    const res = await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapOverlays, res.body.data);
    expect(res.body.meta).toEqual({});
    expect(Object.keys(res.body.data)).toEqual(["overlays"]);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    const overlays = res.body.data.overlays as Overlay[];
    expect(overlays.map((o) => [o.kind, o.id, o.layerId, o.geometry.coordinates.length])).toEqual([
      ["path", "jongro02", "jongro02_route", 252],
      ["path", "jongro07", "jongro07_route", 200],
      ["path", "jongro08", "jongro08_route", 488],
      ["path", "hssc", "hssc_route", 235],
    ]);
    expect(overlays[1]!.geometry.coordinates[0]).toEqual([126.9921543446, 37.5881571127]);
    expect(overlays[1]).toMatchObject({ campus: "hssc", tap: null, subtitle: null, hours: [], text: { ko: "종로07", en: "Jongno 07", zh: "钟路07" } });
  });

  it("answers the same body in every language, with no meta.lang", async () => {
    // Act
    const ko = await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);
    const en = await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP).set("Accept-Language", "en");

    // Assert
    expect(en.status).toBe(200);
    expect(en.body.meta).toEqual({});
    expect(en.body.data).toEqual(ko.body.data);
  });

  it("spends the general rate-limit class once per request", async () => {
    // Arrange
    const before = rateLimitPolicy.counts.get("general")!;

    // Act
    const answers: number[] = [];
    for (let i = 0; i < 3; i++) answers.push((await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP)).status);

    // Assert
    expect(answers).toEqual([200, 200, 200]);
    expect(rateLimitPolicy.counts.get("general")! - before).toBe(3);
  });

  it("lists the three route layers in /map/config, off by default and user-configurable, after the building layers", async () => {
    // Act
    const res = await request(httpServer).get("/map/config").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapConfig, res.body.data);
    const layers = res.body.data.layers as Array<{ id: string; style: { color: string } }>;
    // 08 before 07: the app adds a layer's lines in this order, so 07 lands above the 08 it shares most of its path with.
    expect(layers.map((l) => l.id)).toEqual(["building_numbers", "building_labels", "campus_geometry", "jongro02_route", "jongro08_route", "jongro07_route", "hssc_route"]);
    expect(layers[5]).toEqual({
      id: "jongro07_route",
      label: "종로07 노선",
      defaultVisibleWhen: { kind: "never" },
      userConfigurable: true,
      endpoint: "/map/overlays/transit",
      chipGroupId: null,
      style: { color: "4CAF50", width: 5, outlineWidth: 1.5, outlineColor: "1B5E20", minZoom: 12 },
      tabs: ["transit"],
    });
    expect(layers.slice(3, 6).map((l) => l.style)).toEqual([layers[5]!.style, layers[5]!.style, layers[5]!.style]);
  });

  // WHY: the line color is the map's own constant, never a route's stored themeColor, so /map/config reads no
  // bus dataset.
  it("Every route is drawn in the village-bus green: draws each route's line in 4CAF50 with outline 1B5E20", async () => {
    // Act
    const res = await request(httpServer).get("/map/config").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    const styleByLayerId = new Map((res.body.data.layers as Array<{ id: string; style: Record<string, unknown> }>).map((l) => [l.id, l.style]));
    expect(JONGRO_ROUTES.map((route) => styleByLayerId.get(`${route.id}_route`))).toEqual(
      JONGRO_ROUTES.map(() => expect.objectContaining({ color: "4CAF50", outlineColor: "1B5E20" })),
    );
  });
});

describe("GET /map/overlays/transit when the store cannot be read", () => {
  let app: NestExpressApplication;
  let httpServer: import("http").Server;
  const routePaths = new FakeBusRoutePathRepository();

  beforeAll(async () => {
    routePaths.failWith = new Error("atlas down");
    app = await bootWith(routePaths);
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers 503 with an error body when nothing was read before", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: { code: "JONGRO_ROUTE_PATHS_UNAVAILABLE", message: "The Jongno route lines are unavailable" } });
  });
});

describe("GET /map/overlays/transit with a route not stored", () => {
  let app: NestExpressApplication;
  let httpServer: import("http").Server;
  const routePaths = storedBusRoutePathRepository();

  beforeAll(async () => {
    routePaths.routePaths.delete("jongro07");
    app = await bootWith(routePaths);
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the stored routes only, cached a minute", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapOverlays, res.body.data);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect((res.body.data.overlays as Overlay[]).map((o) => o.id)).toEqual(["jongro02", "jongro08", "hssc"]);
  });
});

describe("GET /map/overlays/transit with the HSSC loop", () => {
  let app: NestExpressApplication;
  let httpServer: import("http").Server;

  beforeAll(async () => {
    app = await bootWith(storedBusRoutePathRepository());
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the stored HSSC loop as stored, closed, after the Jongno lines, named in every language", async () => {
    // Act
    const res = await request(httpServer).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapOverlays, res.body.data);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    const hssc = (res.body.data.overlays as Overlay[]).at(-1)!;
    expect(hssc).toMatchObject({ kind: "path", id: "hssc", layerId: "hssc_route", campus: "hssc", tap: null, order: 3, text: { ko: "인사캠 셔틀버스", en: "HSSC Shuttle Bus", zh: "人文校区班车" } });
    expect(hssc.geometry).toEqual({ type: "LineString", coordinates: hsscRouteLineFixture().path });
    expect(hssc.geometry.coordinates.at(-1)).toEqual(hssc.geometry.coordinates[0]);
  });

  it("lists the HSSC layer last in /map/config, opt-in, in SKKU green with a white edge", async () => {
    // Act
    const res = await request(httpServer).get("/map/config").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapConfig, res.body.data);
    expect((res.body.data.layers as unknown[]).at(-1)).toEqual({
      id: "hssc_route",
      label: "인사캠 셔틀버스 노선",
      defaultVisibleWhen: { kind: "never" },
      userConfigurable: true,
      endpoint: "/map/overlays/transit",
      chipGroupId: null,
      style: { color: "003626", width: 5, outlineWidth: 1.5, outlineColor: "FFFFFF", minZoom: 12 },
      tabs: ["transit"],
    });
  });

  // WHY: installed builds treat a layer with a chip group as festival content and would hide the Jongno toggles with it.
  it("keeps the HSSC layer out of every chip group, as the Jongno route layers are", async () => {
    // Act
    const res = await request(httpServer).get("/map/config").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    const layers = res.body.data.layers as Array<{ id: string; chipGroupId: string | null }>;
    expect(layers.filter((l) => l.id.endsWith("_route")).map((l) => [l.id, l.chipGroupId])).toEqual([
      ["jongro02_route", null],
      ["jongro08_route", null],
      ["jongro07_route", null],
      ["hssc_route", null],
    ]);
  });
});

describe("GET /map/overlays/transit with no HSSC loop ever read", () => {
  let withLine: NestExpressApplication;
  let withoutLine: NestExpressApplication;

  beforeAll(async () => {
    withLine = await bootWith(storedBusRoutePathRepository());
    withoutLine = await bootWith(storedBusRoutePathRepository(), new FakeBusHsscRouteLineRepository());
  });

  afterAll(async () => {
    await withLine.close();
    await withoutLine.close();
  });

  it("serves the Jongno lines exactly as with the loop, without it, cached a minute", async () => {
    // Act
    const res = await request(withoutLine.getHttpServer()).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);
    const full = await request(withLine.getHttpServer()).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    expect(res.status).toBe(200);
    expectWire(mapOverlays, res.body.data);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.body.data.overlays).toEqual((full.body.data.overlays as Overlay[]).filter((o) => o.id !== "hssc"));
    expect((res.body.data.overlays as Overlay[]).map((o) => o.id)).toEqual(["jongro02", "jongro07", "jongro08"]);
  });
});

describe("GET /map/overlays/transit when the HSSC loop cannot be read", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const unreadable = new FakeBusHsscRouteLineRepository();
    unreadable.failWith = new Error("atlas down");
    app = await bootWith(storedBusRoutePathRepository(), unreadable);
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the Jongno lines alone at once, cached a minute, and again without a second wait", async () => {
    // Act
    const first = await request(app.getHttpServer()).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);
    const second = await request(app.getHttpServer()).get("/map/overlays/transit").set("X-Forwarded-For", CLIENT_IP);

    // Assert
    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      expectWire(mapOverlays, res.body.data);
      expect(res.headers["cache-control"]).toBe("public, max-age=60");
      expect((res.body.data.overlays as Overlay[]).map((o) => o.id)).toEqual(["jongro02", "jongro07", "jongro08"]);
    }
  });
});
