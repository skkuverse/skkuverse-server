/**
 * Integration over BusRealtimeGroupController (GET /bus/realtime/data/:groupId)
 * through the production pipeline (buildTestApp), with bus_cache faked in
 * memory and the clock fixed; the pollers never start (ROLE=api), so each
 * process's own memory stays empty and what bus_cache holds is served. Asserts
 * Cache-Control: no-store, meta.{currentTime,totalBuses},
 * data.{groupId,buses,stationEtas}, and 404 GROUP_NOT_FOUND for unknown groups.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { realtimeGroup, realtimeGroupMeta } from "../../../src/bus/realtime/group/bus-realtime-group.wire";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { hsscBusDoc, jongroArrivalDoc, jongroPositionDoc } from "../../helpers/bus/bus-cache-docs";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const NOW = new Date("2026-10-20T01:00:00Z");
const busCache = new FakeBusCacheRepository();

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusCacheModule, BusRealtimeModule, BusRealtimeHsscModule, BusRealtimeJongroModule, BusRealtimeGroupModule],
    overrides: [
      { provide: BusCacheRepository, useValue: busCache },
      { provide: Clock, useValue: { now: () => NOW } },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  busCache.values.clear();
});

describe("GET /bus/realtime/data/:groupId", () => {
  it("hssc → 200 with no-store, meta.currentTime/totalBuses, empty buses", async () => {
    // Act
    const res = await request(httpServer).get("/bus/realtime/data/hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.data).toMatchObject({ groupId: "hssc", buses: [], stationEtas: [] });
    expect(res.body.meta).toHaveProperty("currentTime");
    expect(res.body.meta).toHaveProperty("totalBuses", 0);
    expect(res.body.meta.lang).toBe("ko");
  });

  it("maps buses with parseInt(sequence)-1 and conditional lat/lng spread", async () => {
    // Arrange
    // WHY: HSSC rows never carry coordinates and Jongro positions always do, so each source shows one side.
    busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "3", carNumber: "1234", estimatedTime: 120, latitude: "37.5", longitude: "127.0" }),
    ]);
    busCache.values.set("hssc", [hsscBusDoc({ sequence: "1", carNumber: "5678", estimatedTime: 60 })]);

    // Act
    const jongro = await request(httpServer).get("/bus/realtime/data/jongro07");
    const res = await request(httpServer).get("/bus/realtime/data/hssc");

    // Assert
    expect(jongro.status).toBe(200);
    expect(res.status).toBe(200);
    expect(res.body.meta.totalBuses).toBe(1);
    expect(jongro.body.data.buses[0]).toEqual({
      stationIndex: 2, // 3 - 1
      carNumber: "1234",
      estimatedTime: 120,
      latitude: "37.5",
      longitude: "127.0",
    });
    // The HSSC bus has no latitude/longitude keys (conditional spread).
    expect(res.body.data.buses[0]).toEqual({
      stationIndex: 0,
      carNumber: "5678",
      estimatedTime: 60,
    });
    expect(res.body.data.buses[0]).not.toHaveProperty("latitude");
  });

  it("jongro07 → 200 with empty buses/stationEtas when getters return undefined", async () => {
    // Act
    const res = await request(httpServer).get("/bus/realtime/data/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ groupId: "jongro07", buses: [], stationEtas: [] });
  });

  it("jongro08 → 200 with empty buses/stationEtas when getters return undefined", async () => {
    // Act
    const res = await request(httpServer).get("/bus/realtime/data/jongro08");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ groupId: "jongro08", buses: [], stationEtas: [] });
  });

  it("unknown groupId → 404 GROUP_NOT_FOUND", async () => {
    // Act
    const res = await request(httpServer).get("/bus/realtime/data/nope");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("GROUP_NOT_FOUND");
  });
});

// WHY: a group id is a lookup key, so a name Object.prototype already has must miss like any other
// unknown id (spencer0124/skkuverse#82).
describe("GET /bus/realtime/data/:groupId with an Object.prototype name", () => {
  it.each(["toString", "__proto__", "constructor", "hasOwnProperty"])("%s → 404 GROUP_NOT_FOUND", async (groupId) => {
    // Act
    const res = await request(httpServer).get(`/bus/realtime/data/${groupId}`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "GROUP_NOT_FOUND", message: `Unknown groupId: ${groupId}` });
  });
});

describe("GET /bus/realtime/data/:groupId bodies", () => {
  it.each(["hssc", "jongro07", "jongro08"])("%s parses with the published wire schemas, empty and with buses and arrivals", async (groupId) => {
    // Arrange
    const empty = await request(httpServer).get(`/bus/realtime/data/${groupId}`);
    busCache.values.set("hssc", [hsscBusDoc()]);
    busCache.values.set("jongro_locations_07", [jongroPositionDoc()]);
    busCache.values.set("jongro_stations_07", [jongroArrivalDoc()]);
    busCache.values.set("jongro_locations_08", [jongroPositionDoc()]);
    busCache.values.set("jongro_stations_08", [jongroArrivalDoc()]);

    // Act
    const res = await request(httpServer).get(`/bus/realtime/data/${groupId}`);

    // Assert
    expect([empty.status, res.status]).toEqual([200, 200]);
    expect(res.body.meta.totalBuses).toBe(1);
    for (const body of [empty.body, res.body]) {
      const { lang, ...meta } = body.meta;
      expect(lang).toBe("ko");
      expectWire(realtimeGroup, body.data);
      expectWire(realtimeGroupMeta, meta);
    }
  });
});
