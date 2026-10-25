/**
 * GET /bus/live/:groupId (ADR 0019) through the production pipeline, over an in-memory bus_cache, the stored
 * registry, route attributes and stops, and a clock at 10:00 KST on Tuesday 2026-10-20: a Jongno route's buses and
 * station arrivals, the HSSC line running, laying over, wrapping its loop and with no bus, each in the one live shape
 * with `no-store` and `meta.serverNow`; a schedule group answers 404 GROUP_NOT_LIVE and an unknown one GROUP_NOT_FOUND.
 * Each vehicle's low-floor flag comes from TOPIS's bus type on the cached rows, null over rows a poller older than the
 * field wrote and on the HSSC line, and the deprecated realtime route never serves the bus type.
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
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeGroupModule } from "../../../src/bus/realtime/group/bus-realtime-group.module";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusRealtimeHsscEtaModule } from "../../../src/bus/realtime/hssc-eta/bus-realtime-hssc-eta.module";
import { BusRealtimeJongroModule } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.module";
import { BusRegistryModule } from "../../../src/bus/registry/bus-registry.module";
import { BusRegistryRepository } from "../../../src/bus/registry/bus-registry.repository";
import { BusRouteAttributesModule } from "../../../src/bus/route-attributes/bus-route-attributes.module";
import { BusRouteAttributesRepository } from "../../../src/bus/route-attributes/bus-route-attributes.repository";
import { BusRoutePathRepository } from "../../../src/bus/route-path/bus-route-path.repository";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { BusStopsRepository } from "../../../src/bus/stops/bus-stops.repository";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { hsscBusDoc, jongroArrivalBus, jongroArrivalDoc, jongroPositionDoc } from "../../helpers/bus/bus-cache-docs";
import { storedBusRegistryRepository } from "../../helpers/bus/bus-registry";
import { storedBusRoutePathRepository } from "../../helpers/bus/bus-route-path";
import { storedBusStopsRepository } from "../../helpers/bus/bus-stops";
import { storedRouteAttributesRepository } from "../../helpers/bus/route-attributes";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const NOW = new Date("2026-10-20T01:00:00Z");
const busCache = new FakeBusCacheRepository();

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
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
      { provide: BusRegistryRepository, useValue: storedBusRegistryRepository() },
      { provide: BusRouteAttributesRepository, useValue: storedRouteAttributesRepository() },
      { provide: BusRoutePathRepository, useValue: storedBusRoutePathRepository() },
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

afterEach(() => {
  busCache.values.clear();
  busCache.updatedAtByKey.clear();
});

const withoutLang = ({ lang: _lang, ...meta }: { lang?: string }) => meta;

// An HSSC bus as the poller caches it: the feed's row, its linear sequence and its first sighting.
function hsscBus(lineNo: string, seq: number, inout: string, kstTime: string) {
  const [hour, minute, second] = kstTime.split(":");
  return hsscBusDoc({
    line_no: lineNo,
    seq: String(seq),
    inout,
    sequence: String(seq >= 5 ? seq - 4 : seq + 7),
    get_date: `2026-10-20 오전 ${Number(hour)}:${minute}:${second}`,
    eventDate: `2026-10-20 ${kstTime}`,
  });
}

describe("GET /bus/live/:groupId for a Jongno route", () => {
  it("serves its tracked buses and each station's arrivals in the live shape", async () => {
    // Arrange
    busCache.values.set("jongro_locations_07", [jongroPositionDoc({ sequence: "6", observedAt: "2026-10-20T09:59:30+09:00" })]);
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ stationId: "100900220", sequence: "1", eventDate: "2026-10-20 09:59:00.0", buses: [jongroArrivalBus({ staOrd: 1, sectOrd: 0, traTime: 180, arrmsg: "3분후[1번째 전]" })] }),
    ]);

    // Act
    const res = await request(httpServer).get("/bus/live/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.meta).toEqual({ lang: "ko", serverNow: "2026-10-20T10:00:00+09:00" });
    expectWire(liveGroup, res.body.data);
    expectWire(liveGroupMeta, withoutLang(res.body.meta));
    expect(res.body.data).toMatchObject({ groupId: "jongro07", stationsVersion: "0346768f2b776f45", updatedAt: "2026-10-20T10:00:00+09:00", operation: "running" });
    expect(res.body.data.vehicles).toMatchObject([{ id: "100000103", plateNumber: "서울74사5537", position: { stationIndex: 5, status: "inTransit" } }]);
    expect(res.body.data.stations).toEqual([
      {
        stationIndex: 0,
        stopId: "100900220",
        arsId: "01617",
        operation: "running",
        arrivals: [
          {
            status: "enRoute",
            expectedArrivalAt: "2026-10-20T10:02:00+09:00",
            ...{ expectedDepartureAt: null, scheduledArrivalAt: null, scheduledDepartureAt: null },
            basis: "provider",
            stopsAway: 2,
            runId: null,
            vehicleId: "100000103",
            ...{ headsign: "이화사거리 방면", isFirstRun: null, isLastRun: false, isExpress: null },
            providerText: "3분후[1번째 전]",
          },
        ],
      },
    ]);
  });
});

describe("GET /bus/live/:groupId counts Jongno stops away as ADR 0019 D4 does", () => {
  it("serves the station a bus heads to as 1 stop away and arriving on TOPIS's 곧 도착, the one after its [2번째 전] as 3", async () => {
    // Arrange
    // WHY: TOPIS's own pair for 서울70사5538 on 2026-10-17 (topis-jongro-positions.json at 19:11:45, topis-jongro-arrivals.json
    // jongro07Running at 19:12:10), moved to 09:59 KST on the 20th: the position has it past 학생회관 (index 1) toward 비천당.
    busCache.values.set("jongro_locations_07", [
      jongroPositionDoc({ sequence: "2", stationId: "100900221", vehicleId: "100000114", plainNo: "서울70사5538", sectDist: 0.06, fullSectDist: 0.289, observedAt: "2026-10-20T09:59:35+09:00" }),
    ]);
    const bus = { vehId: "100000114", plainNo: "서울70사5538", sectOrd: 3 };
    busCache.values.set("jongro_stations_07", [
      jongroArrivalDoc({ stationId: "100000424", sequence: "3", eventDate: "2026-10-20 10:00:00.0", buses: [jongroArrivalBus({ ...bus, staOrd: 3, traTime: 8, arrmsg: "곧 도착" })] }),
      jongroArrivalDoc({ stationId: "100000421", sequence: "5", eventDate: "2026-10-20 10:00:00.0", buses: [jongroArrivalBus({ ...bus, staOrd: 5, traTime: 94, arrmsg: "2분후[2번째 전]" })] }),
    ]);

    // Act
    const res = await request(httpServer).get("/bus/live/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expect(res.body.data.vehicles).toMatchObject([{ id: "100000114", position: { stationIndex: 1, status: "inTransit" } }]);
    expect(res.body.data.stations.map(({ stationIndex, arrivals }: { stationIndex: number; arrivals: Array<{ status: string; stopsAway: number }> }) => [stationIndex, arrivals.map(({ status, stopsAway }) => [status, stopsAway])])).toEqual([
      [2, [["arriving", 1]]],
      [4, [["enRoute", 3]]],
    ]);
  });
});

describe("GET /bus/live/:groupId for the HSSC line", () => {
  it("serves a running bus's estimates at every stop, the rotary passes left out", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBus("32149", 0, "LEFT", "09:59:50")]);

    // Act
    const res = await request(httpServer).get("/bus/live/hssc");

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expectWire(liveGroupMeta, withoutLang(res.body.meta));
    expect(res.body.data).toMatchObject({ groupId: "hssc", stationsVersion: null, operation: "running" });
    expect(res.body.data.stations.map((station: { stationIndex: number }) => station.stationIndex)).toEqual([0, 1, 2, 3, 4, 6, 8, 9, 10]);
    // WHY: 성균관대입구사거리 (station 8) is 20 s of travel to the rotary, then its 12 s and 70 s, away: its next stop.
    expect(res.body.data.stations.find((station: { stationIndex: number }) => station.stationIndex === 8)).toMatchObject({
      stopId: "hssc-skku-junction",
      arsId: null,
      arrivals: [{ status: "enRoute", expectedArrivalAt: "2026-10-20T10:01:42+09:00", basis: "estimate", stopsAway: 1, vehicleId: "32149" }],
    });
    // WHY: 혜화역 1번출구, which it just left, is a lap away across the layover.
    expect(res.body.data.stations.find((station: { stationIndex: number }) => station.stationIndex === 6).arrivals).toMatchObject([{ status: "waitingToDepart", stopsAway: 9 }]);
  });

  it("serves a bus laying over at 농구장 first there, waiting to depart, with no trajectory", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBus("32150", 5, "ENTERED", "09:52:00"), hsscBus("32149", 4, "LEFT", "09:59:50")]);

    // Act
    const res = await request(httpServer).get("/bus/live/hssc");

    // Assert
    expectWire(liveGroup, res.body.data);
    expect(res.body.data.stations[0]).toMatchObject({
      stationIndex: 0,
      stopId: "hssc-basketball-court",
      arrivals: [
        { status: "waitingToDepart", stopsAway: 0, vehicleId: "32150" },
        { status: "enRoute", stopsAway: 1, expectedArrivalAt: "2026-10-20T10:00:20+09:00", vehicleId: "32149" },
      ],
    });
    expect(res.body.data.vehicles.find((vehicle: { id: string }) => vehicle.id === "32150")).toMatchObject({ position: { stationIndex: 0, status: "waitingToDepart", nextStationAt: null }, trajectory: null });
  });

  it("wraps a bus's trajectory past the last station back to 농구장", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBus("32149", 3, "LEFT", "09:59:50")]);

    // Act
    const res = await request(httpServer).get("/bus/live/hssc");

    // Assert
    expectWire(liveGroup, res.body.data);
    // WHY: 47 s more to 600주년(등교), its 33 s there, then 30 s to 농구장, which ends the lap at s = 11 (station 0 again).
    const [vehicle] = res.body.data.vehicles;
    expect(vehicle.trajectory.map((knot: { s: number }) => knot.s)).toEqual([9, 10, 10, 11]);
    expect(vehicle.trajectory.at(-1)).toEqual({ at: "2026-10-20T10:01:50+09:00", s: 11 });
  });

  it("serves no data when no bus is fresh", async () => {
    // Act
    const res = await request(httpServer).get("/bus/live/hssc");

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expect(res.body.data).toEqual({ groupId: "hssc", stationsVersion: null, updatedAt: null, operation: "noData", vehicles: [], stations: [] });
  });
});

describe("GET /bus/live/:groupId for a group with no live route", () => {
  it.each([
    ["campus", "GROUP_NOT_LIVE"],
    ["nope", "GROUP_NOT_FOUND"],
  ])("answers %s with 404 %s", async (groupId, code) => {
    // Act
    const res = await request(httpServer).get(`/bus/live/${groupId}`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(code);
  });
});

// WHY: an api replica can read rows an older poller wrote during a deploy (ADR 0012), and the old route is frozen (ADR 0019, D11).
describe("GET /bus/live/:groupId low floor", () => {
  const seedJongro07 = (positionBusType?: "lowFloor", arrivalBusType?: "general") => {
    busCache.values.set("jongro_locations_07", [jongroPositionDoc({ sequence: "6", ...(positionBusType && { busType: positionBusType }) })]);
    const untracked = jongroArrivalBus({ staOrd: 1, sectOrd: 0, traTime: 180, vehId: "100000200", plainNo: "서울70사5536", arrmsg: "3분후[1번째 전]", ...(arrivalBusType && { busType: arrivalBusType }) });
    busCache.values.set("jongro_stations_07", [jongroArrivalDoc({ stationId: "100900220", sequence: "1", eventDate: "2026-10-20 09:59:00.0", buses: [untracked] })]);
  };

  it("serves each Jongno vehicle's low-floor flag from its cached row", async () => {
    // Arrange
    seedJongro07("lowFloor", "general");

    // Act
    const res = await request(httpServer).get("/bus/live/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expect(res.body.data.vehicles.map(({ id, isLowFloor }: { id: string; isLowFloor: unknown }) => [id, isLowFloor])).toEqual([
      ["100000103", true],
      ["100000200", false],
    ]);
  });

  it("serves null, not an error, over rows a poller older than the bus type wrote", async () => {
    // Arrange
    seedJongro07();

    // Act
    const res = await request(httpServer).get("/bus/live/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expectWire(liveGroup, res.body.data);
    expect(res.body.data.vehicles.map(({ id, isLowFloor }: { id: string; isLowFloor: unknown }) => [id, isLowFloor])).toEqual([
      ["100000103", null],
      ["100000200", null],
    ]);
  });

  it("serves null on the HSSC line, whose feed names no vehicle type", async () => {
    // Arrange
    busCache.values.set("hssc", [hsscBus("1", 6, "LEFT", "09:59:50")]);

    // Act
    const res = await request(httpServer).get("/bus/live/hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.vehicles.map(({ isLowFloor }: { isLowFloor: unknown }) => isLowFloor)).toEqual([null]);
  });

  it("keeps the bus type out of the deprecated realtime route", async () => {
    // Arrange
    seedJongro07("lowFloor", "general");

    // Act
    const res = await request(httpServer).get("/bus/realtime/data/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.buses).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/busType|lowFloor|LowFloor/);
  });
});
