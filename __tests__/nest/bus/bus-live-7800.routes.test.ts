/**
 * GET /bus/live/gyeonggi7800 through the production pipeline, from what the 7800 poller stores: one tick of
 * BusRealtimeJongroService over TOPIS's 2026-10-24 17:51 KST capture (fixtures/topis-7800-*.json, through a scripted
 * client), on the registry the poller's bootstrap stores, with route attributes that hold no 7800 (it is on no card)
 * and the stops of revision 1. It answers in the one live shape (ADR 0019) at 17:51:10 KST: 80 stations, both slots of
 * the origin waiting to depart, TOPIS's `[0번째 전]` one stop away, stops away counting only the stations a bus stops
 * at, no occupancy, no low-floor answer for TOPIS's busType 2, and no stop id at any pole no local stop aliases. With
 * its stations stored but no bus_cache key (a stopped poller, or REGIONAL_BUS off after one stored them), it answers
 * noData. The frozen realtime route serves no 7800. With GBIS's 2026-10-24 20:22 answer stored by one seat poller tick
 * (fixtures/gbis-location-7800.json, through a scripted client), each vehicle GBIS names by the same vehId serves its
 * seats left, every other vehicle null, and once that answer is past its 200 s bound, every vehicle null again; when
 * bus_seats cannot be read, it still answers 200 with every arrival, its vehicles' seats null.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusModule } from "../../../src/bus/bus.module";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusConfigModule } from "../../../src/bus/config/bus-config.module";
import { BusLiveGroupModule } from "../../../src/bus/live/group/bus-live-group.module";
import { BusLiveHsscModule } from "../../../src/bus/live/hssc/bus-live-hssc.module";
import { BusLiveJongroModule } from "../../../src/bus/live/jongro/bus-live-jongro.module";
import { BusLiveModule } from "../../../src/bus/live/bus-live.module";
import { liveGroup, liveGroupMeta } from "../../../src/bus/live/bus-live.wire";
import { BusRealtimeArrivalModule } from "../../../src/bus/realtime/arrival/bus-realtime-arrival.module";
import { BusRealtimeGbisClient } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.client";
import { BusRealtimeGbisModule } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.module";
import { BusRealtimeGbisRepository } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.repository";
import { BusRealtimeGbisService } from "../../../src/bus/realtime/gbis/bus-realtime-gbis.service";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeHsscEtaModule } from "../../../src/bus/realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusRealtimeJongroClient } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRealtimeJongroService } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.service";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesModule } from "../../../src/bus/route-attributes/bus-route-attributes.module";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { ROUTE_7800, arrivalDocs7800, registryDoc7800, sightings7800 } from "../../helpers/bus/topis-7800";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { FakeBusRealtimeGbisClient } from "../../helpers/fakes/bus/bus-realtime-gbis.client.fake";
import { FakeBusRealtimeGbisRepository } from "../../helpers/fakes/bus/bus-realtime-gbis.repository.fake";
import { FakeBusRealtimeJongroClient } from "../../helpers/fakes/bus/bus-realtime-jongro.client.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";
import gbisCapture from "./fixtures/gbis-location-7800.json";

const NOW = new Date("2026-10-24T08:51:10Z");
const busCache = new FakeBusCacheRepository();
const client = new FakeBusRealtimeJongroClient();
const gbisClient = new FakeBusRealtimeGbisClient();
const seats = new FakeBusRealtimeGbisRepository();

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  const registryRepository = storedBusRegistryRepository();
  registryRepository.routes.set("gyeonggi7800", registryDoc7800());
  app = await buildTestApp({
    imports: [
      SchedulingModule,
      BusModule,
      BusCacheModule,
      BusRegistryModule,
      BusRouteAttributesModule,
      BusRealtimeModule,
      BusRealtimeHsscModule,
      BusRealtimeJongroModule,
      BusRealtimeGbisModule,
      BusRealtimeArrivalModule,
      BusRealtimeGroupModule,
      BusRealtimeHsscEtaModule,
      BusStopsModule,
      BusConfigModule,
      BusLiveModule,
      BusLiveJongroModule,
      BusLiveHsscModule,
      BusLiveGroupModule,
    ],
    overrides: [
      { provide: BusCacheRepository, useValue: busCache },
      { provide: BusRealtimeJongroClient, useValue: client },
      { provide: BusRealtimeGbisClient, useValue: gbisClient },
      { provide: BusRealtimeGbisRepository, useValue: seats },
      { provide: BusRegistryRepository, useValue: registryRepository },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusStopsRepository, useValue: storedBusStopsRepository() },
      { provide: Clock, useValue: { now: () => NOW } },
    ],
    role: "api",
  });
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

const withoutLang = ({ lang: _lang, ...meta }: { lang?: string }) => meta;

// One tick of the 7800 poller over the capture, which writes both bus_cache keys at NOW.
async function pollCapture(): Promise<void> {
  busCache.writtenAt = NOW;
  client.arrivals = arrivalDocs7800();
  client.sightings = sightings7800();
  await app.get(BusRealtimeJongroService).refresh(ROUTE_7800);
}

type Station = { stationIndex: number; stopId: string | null; arsId: string | null; arrivals: Array<Record<string, unknown>> };
const stationAt = (stations: Station[], staOrd: number): Station => stations.find((station) => station.stationIndex === staOrd - 1)!;

describe("GET /bus/live/gyeonggi7800 over 7800's capture", () => {
  beforeAll(async () => {
    await pollCapture();
  });

  it("serves the route in the live shape, every station, no-store, with no attributes stored for it", async () => {
    // Act
    const res = await request(httpServer).get("/bus/live/gyeonggi7800");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expectWire(liveGroup, res.body.data);
    expectWire(liveGroupMeta, withoutLang(res.body.meta));
    expect(res.body.meta).toEqual({ lang: "ko", serverNow: "2026-10-24T17:51:10+09:00" });
    expect(res.body.data).toMatchObject({ groupId: "gyeonggi7800", stationsVersion: registryDoc7800().stationsVersion, updatedAt: "2026-10-24T17:51:10+09:00", operation: "running" });
    expect(res.body.data.stations).toHaveLength(80);
  });

  it("serves both slots at 호매실동차고지 waiting to depart, and [0번째 전] one stop away at mkTm plus its travel time", async () => {
    // Act
    const { stations } = (await request(httpServer).get("/bus/live/gyeonggi7800")).body.data as { stations: Station[] };

    // Assert
    expect(stationAt(stations, 1).arrivals.map(({ status, providerText }) => [status, providerText])).toEqual([
      ["waitingToDepart", "출발대기"],
      ["waitingToDepart", "출발대기"],
    ]);
    expect(stationAt(stations, 26).arrivals[0]).toEqual({
      status: "enRoute",
      expectedArrivalAt: "2026-10-24T17:53:37+09:00",
      ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
      basis: "provider",
      stopsAway: 1,
      isLastBus: false,
      vehicleId: "200010901",
      providerText: "2분34초후[0번째 전]",
    });
  });

  it("counts stops away over the stations a bus stops at, leaving out the …(미정차) ones TOPIS counts", async () => {
    // Act
    const { stations } = (await request(httpServer).get("/bus/live/gyeonggi7800")).body.data as { stations: Station[] };

    // Assert
    expect(stationAt(stations, 31).arrivals.map(({ providerText, stopsAway }) => [providerText, stopsAway])).toEqual([
      ["10분25초후[5번째 전]", 3],
      ["17분57초후[8번째 전]", 6],
    ]);
  });

  it("serves no vehicle an occupancy, and no low-floor answer for busType 2 beside false for busType 0", async () => {
    // Act
    const { vehicles } = (await request(httpServer).get("/bus/live/gyeonggi7800")).body.data as { vehicles: Array<{ id: string; occupancy: unknown; isLowFloor: boolean | null; plateNumber: string }> };

    // Assert
    expect(vehicles.filter(({ occupancy }) => occupancy !== null)).toEqual([]);
    expect(["233000041", "233000031"].map((id) => vehicles.find((vehicle) => vehicle.id === id)).map((vehicle) => [vehicle?.plateNumber, vehicle?.isLowFloor])).toEqual([
      ["경기70사1145", null],
      ["경기70사1132", false],
    ]);
  });

  it("names no stop at a pole no local stop aliases, while serving its ARS number", async () => {
    // Act
    const { stations } = (await request(httpServer).get("/bus/live/gyeonggi7800")).body.data as { stations: Station[] };

    // Assert
    expect(stations.filter((station) => station.stopId !== null)).toEqual([]);
    expect([31, 39, 41, 24].map((staOrd) => stationAt(stations, staOrd).arsId)).toEqual(["27113", "22028", "20253", null]);
  });

  it("serves no 7800 on the frozen realtime route", async () => {
    // Act
    const res = await request(httpServer).get("/bus/realtime/data/gyeonggi7800");

    // Assert
    expect([res.status, res.body.error.code]).toEqual([404, "GROUP_NOT_FOUND"]);
  });
});

// One seat poller tick at NOW over GBIS's answer, as the test reads it: each bus's vehId and remainSeatCnt.
async function pollSeats(): Promise<void> {
  gbisClient.seats = gbisCapture.response.msgBody.busLocationList.map(({ vehId, remainSeatCnt }) => ({ vehicleId: String(vehId), seatsLeft: remainSeatCnt }));
  await app.get(BusRealtimeGbisService).refresh(ROUTE_7800);
}

describe("GET /bus/live/gyeonggi7800 with GBIS's seats stored", () => {
  beforeAll(async () => {
    await pollCapture();
    await pollSeats();
  });

  afterAll(() => {
    seats.seatsByRouteId.clear();
  });

  it("serves each vehicle GBIS names by its vehId its seats left, and every other vehicle null", async () => {
    // Act
    const res = await request(httpServer).get("/bus/live/gyeonggi7800");

    // Assert
    expectWire(liveGroup, res.body.data);
    const vehicles = res.body.data.vehicles as Array<{ id: string; seatsLeft: number | null }>;
    const seated = vehicles.filter(({ seatsLeft }) => seatsLeft !== null).map(({ id, seatsLeft }) => [id, seatsLeft]);
    expect(seated.sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual([
      ["200010839", 41],
      ["200010899", 70],
      ["200011123", 35],
      ["200011605", 65],
      ["200011682", 39],
      ["200011684", 37],
      ["233000041", 70],
      ["233000065", 35],
    ]);
    expect(vehicles.length).toBeGreaterThan(seated.length);
  });

  it("answers 200 with every arrival and no seats when bus_seats cannot be read", async () => {
    // Arrange
    seats.readFailWith = new Error("operation exceeded time limit");

    // Act
    let res: request.Response;
    try {
      res = await request(httpServer).get("/bus/live/gyeonggi7800");
    } finally {
      seats.readFailWith = null;
    }

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expect(res.body.data.stations).toHaveLength(80);
    expect((res.body.data.vehicles as Array<{ seatsLeft: number | null }>).filter(({ seatsLeft }) => seatsLeft !== null)).toEqual([]);
  });

  it("serves every vehicle null once the stored answer is past its 200 s bound", async () => {
    // Arrange
    const stored = seats.seatsByRouteId.get("gyeonggi7800")!;
    seats.seatsByRouteId.set("gyeonggi7800", { ...stored, checkedAt: new Date(NOW.getTime() - 200_001) });

    // Act
    const res = await request(httpServer).get("/bus/live/gyeonggi7800");

    // Assert
    expect(res.status).toBe(200);
    expect((res.body.data.vehicles as Array<{ seatsLeft: number | null }>).filter(({ seatsLeft }) => seatsLeft !== null)).toEqual([]);
  });
});

describe("GET /bus/live/gyeonggi7800 with its stations stored and nothing in bus_cache", () => {
  it("answers noData with no vehicle and no station, as for a stopped poller", async () => {
    // Arrange
    busCache.values.clear();
    busCache.updatedAtByKey.clear();

    // Act
    const res = await request(httpServer).get("/bus/live/gyeonggi7800");

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expect(res.body.data).toEqual({ groupId: "gyeonggi7800", stationsVersion: registryDoc7800().stationsVersion, updatedAt: null, operation: "noData", vehicles: [], stations: [] });
  });
});
