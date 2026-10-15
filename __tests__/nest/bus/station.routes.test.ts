/**
 * Integration over BusStationController (GET /bus/station/:stationId) through
 * the production pipeline (buildTestApp), with bus_cache faked in memory and
 * the clock fixed; the pollers never start (ROLE=api), so no DB or upstream
 * runs. Asserts the non-01592 → empty data (no totalCount meta) and 01592 →
 * the exact 2-element body + meta.totalCount:2, with the station message and
 * the hssc ETA from each process's own (empty) state.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { BusCacheModule } from "../../../src/bus/cache/bus-cache.module";
import { BusCacheRepository } from "../../../src/bus/cache/bus-cache.repository";
import { BusRealtimeModule } from "../../../src/bus/realtime/bus-realtime.module";
import { BusRealtimeHsscModule } from "../../../src/bus/realtime/hssc/bus-realtime-hssc.module";
import { BusStationModule } from "../../../src/bus/station/bus-station.module";
import { stationArrivals, stationArrivalsMeta } from "../../../src/bus/station/bus-station.wire";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { hsscBusDoc } from "../../helpers/bus/bus-cache-docs";
import { expectWire } from "../../helpers/contracts/expect-wire";
import { FakeBusCacheRepository } from "../../helpers/fakes/bus/bus-cache.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const busCache = new FakeBusCacheRepository();

let app: NestExpressApplication;
let httpServer: import("http").Server;

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, BusCacheModule, BusRealtimeModule, BusRealtimeHsscModule, BusStationModule],
    overrides: [
      { provide: BusCacheRepository, useValue: busCache },
      { provide: Clock, useValue: { now: () => new Date("2026-10-20T01:00:00Z") } },
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

describe("GET /bus/station/:stationId", () => {
  it("non-01592 → empty data array, no totalCount meta", async () => {
    // Act
    const res = await request(httpServer).get("/bus/station/99999");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).not.toHaveProperty("totalCount");
    expect(res.body.meta.lang).toBe("ko");
  });

  it("01592 → 2-element body + meta.totalCount 2", async () => {
    // Act
    const res = await request(httpServer).get("/bus/station/01592");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta.totalCount).toBe(2);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      busNm: "종로07",
      busSupportTime: true,
      msg1ShowMessage: true,
      msg1Message: "정보 없음",
    });
    expect(res.body.data[1]).toMatchObject({
      busNm: "인사캠셔틀",
      busSupportTime: false,
      msg1ShowMessage: true,
      // hssc empty → "도착 정보 없음" (no bus before 혜화역(승차장) in HSSC_ETA_STATIONS)
      msg1Message: "도착 정보 없음",
    });
  });
});

describe("GET /bus/station/:stationId bodies", () => {
  it("parse with the published wire schemas, for 01592 and for any other station", async () => {
    // Arrange
    busCache.values.set("station", "3분후[1번째 전]");
    busCache.values.set("hssc", [hsscBusDoc()]);

    // Act
    const other = await request(httpServer).get("/bus/station/99999");
    const station = await request(httpServer).get("/bus/station/01592");
    const { lang, ...meta } = station.body.meta;

    // Assert
    expect([other.status, station.status]).toEqual([200, 200]);
    expect(lang).toBe("ko");
    expect(station.body.data[0].msg1Message).toBe("3분후[1번째 전]");
    expectWire(stationArrivals, other.body.data);
    expectWire(stationArrivals, station.body.data);
    expectWire(stationArrivalsMeta, meta);
  });
});
