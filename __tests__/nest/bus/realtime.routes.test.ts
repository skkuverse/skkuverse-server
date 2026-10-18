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
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { realtimeGroup, realtimeGroupMeta } from "../../../src/bus/realtime/group/bus-realtime-group.wire";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { Clock } from "../../../src/infra/clock";
import config from "../../../src/infra/config";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { hsscBusDoc, jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc, noArrivalBus } from "../../helpers/bus/bus-cache-docs";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRegistryRepository } from "../../helpers/fakes/bus/bus-registry.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const NOW = new Date("2026-10-20T01:00:00Z");
const busCache = new FakeBusCacheRepository();
const registryRepository = new FakeBusRegistryRepository();

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusCacheModule, BusRegistryModule, BusRealtimeModule, BusRealtimeHsscModule, BusRealtimeJongroModule, BusRealtimeGroupModule],
    overrides: [
      { provide: BusCacheRepository, useValue: busCache },
      { provide: BusRegistryRepository, useValue: registryRepository },
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
    // WHY: kind and tracked are what add-jongro-bus-positions adds (task 2.2); the top-level fields are as before.
    expect(jongro.body.data.buses[0]).toEqual({
      stationIndex: 2, // 3 - 1
      carNumber: "1234",
      estimatedTime: 120,
      latitude: "37.5",
      longitude: "127.0",
      kind: "tracked",
      tracked: {
        status: "running",
        vehicleId: "100000103",
        observedAt: "2026-10-20T10:00:00+09:00",
        crowding: null,
        isLastBus: false,
        progress: 0.5,
        segmentMeters: 300,
        nextStopInSec: null,
      },
    });
    // The HSSC bus has no latitude/longitude keys (conditional spread).
    expect(res.body.data.buses[0]).toEqual({
      stationIndex: 0,
      carNumber: "5678",
      estimatedTime: 60,
      kind: "estimated",
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

// WHY: every bus says whether it is estimated or tracked, and a tracked bus's status decides which fields it
// carries (add-jongro-bus-positions D1); each status must parse with the published schema.
describe("GET /bus/realtime/data/jongro02 tracked buses", () => {
  it("serves a running, an atStop and a waiting bus that parse with the published wire schema", async () => {
    // Arrange
    busCache.values.set("jongro_locations_02", [
      jongroPositionDoc({ sequence: "17", stationId: "100000104", vehicleId: "100000058", sectDist: 0.114, fullSectDist: 0.251, observedAt: "2026-10-17T19:12:02+09:00" }),
      jongroPositionDoc({ sequence: "15", stationId: "100000103", vehicleId: "100000059", isAtStop: true, observedAt: "2026-10-17T19:12:01+09:00" }),
      jongroPositionDoc({ sequence: "1", stationId: "100900204", vehicleId: "100000018", isStationary: true, observedAt: "2026-10-17T19:11:58+09:00" }),
    ]);
    busCache.values.set("jongro_stations_02", [
      jongroArrivalDoc({
        stationId: "100900172",
        sequence: "18",
        eventDate: "2026-10-17 19:12:10.0",
        eta: "곧 도착",
        buses: [jongroArrivalBus({ vehId: "100000058", staOrd: 18, sectOrd: 18, traTime: 20, arrmsg: "곧 도착", rerideNum: 1 }), noArrivalBus({ staOrd: 18 })],
      }),
    ]);

    // Act
    const res = await request(httpServer).get("/bus/realtime/data/jongro02");

    // Assert
    expect(res.status).toBe(200);
    expectWire(realtimeGroup, res.body.data);
    expect(res.body.data.buses.map((bus: { kind: string; tracked: { status: string } }) => [bus.kind, bus.tracked.status])).toEqual([
      ["tracked", "running"],
      ["tracked", "atStop"],
      ["tracked", "waiting"],
    ]);
    expect(res.body.data.buses[0].tracked).toMatchObject({ nextStopInSec: 28, segmentMeters: 251 });
    expect(Object.keys(res.body.data.buses[1].tracked).sort()).toEqual(["crowding", "isLastBus", "observedAt", "status", "vehicleId"]);
  });

  it("serves every HSSC bus as estimated, with no tracked object", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBusDoc()]);

    // Act
    const res = await request(httpServer).get("/bus/realtime/data/hssc");

    // Assert
    expectWire(realtimeGroup, res.body.data);
    expect(res.body.data.buses).toEqual([expect.objectContaining({ kind: "estimated" })]);
    expect(res.body.data.buses[0]).not.toHaveProperty("tracked");
  });
});

// WHY: installed apps read only stationIndex and eta, so arrivals is added beside them and eta stays TOPIS's
// first-bus text exactly.
describe("GET /bus/realtime/data/jongro07 arrivals", () => {
  it("keeps every eta byte for byte and adds arrivals to every entry", async () => {
    // Arrange
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({
        stationId: "100900220",
        sequence: "1",
        eta: "곧 도착",
        buses: [
          jongroArrivalBus({ arrmsg: "곧 도착", traTime: 95, staOrd: 1, sectOrd: 1 }),
          jongroArrivalBus({ arrmsg: "7분50초후[4번째 전]", traTime: 470, staOrd: 1, sectOrd: 19 }),
        ],
      }),
      jongroArrivalDoc({
        stationId: "100900221",
        sequence: "2",
        eta: "출발대기",
        buses: [jongroArrivalBus({ arrmsg: "출발대기", traTime: 228, staOrd: 2, sectOrd: 2, rerideDiv: 0 }), noArrivalBus({ arrmsg: "" })],
      }),
      jongroArrivalDoc({
        stationId: "100000424",
        sequence: "3",
        eta: "3분12초후[2번째 전]",
        buses: [jongroArrivalBus({ arrmsg: "3분12초후[2번째 전]", traTime: 192, staOrd: 3, sectOrd: 1 }), noArrivalBus({ arrmsg: "" })],
      }),
    ]);

    // Act
    const res = await request(httpServer).get("/bus/realtime/data/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expectWire(realtimeGroup, res.body.data);
    expect(res.body.data.stationEtas.map((entry: { eta: string }) => entry.eta)).toEqual(["곧 도착", "출발대기", "3분12초후[2번째 전]"]);
    expect(
      res.body.data.stationEtas.map((entry: { arrivals: Array<{ state: string; minutes: number | null }> }) =>
        entry.arrivals.map((arrival) => [arrival.state, arrival.minutes]),
      ),
    ).toEqual([[["arriving", null], ["running", 8]], [["waiting", null]], [["running", 3]]]);
  });
});

// WHY: a Jongro response names the stations version it was placed by, as its /bus/config group does; HSSC has
// none; and with its registry route gone the route answers 503 instead of an empty or stale list (D7, D10).
describe("GET /bus/realtime/data/:groupId and the registry", () => {
  it("serves jongro07's stored stations version, and none for hssc", async () => {
    // Act
    const jongro = await request(httpServer).get("/bus/realtime/data/jongro07");
    const hssc = await request(httpServer).get("/bus/realtime/data/hssc");

    // Assert
    expect(jongro.status).toBe(200);
    expectWire(realtimeGroup, jongro.body.data);
    expect(jongro.body.data.stationsVersion).toBe(registryRepository.routes.get("jongro07")!.stationsVersion);
    expect(hssc.body.data).not.toHaveProperty("stationsVersion");
  });

  it("answers 503 JONGRO_REGISTRY_UNAVAILABLE when jongro02's registry route is missing", async () => {
    // Arrange
    const stored = registryRepository.routes.get("jongro02")!;
    registryRepository.routes.delete("jongro02");
    const previous = config.cache.enabled;
    config.cache.enabled = false;

    try {
      // Act
      const res = await request(httpServer).get("/bus/realtime/data/jongro02");

      // Assert
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: { code: "JONGRO_REGISTRY_UNAVAILABLE", message: "The station registry of jongro02 is unavailable" } });
    } finally {
      config.cache.enabled = previous;
      registryRepository.routes.set("jongro02", stored);
    }
  });
});
