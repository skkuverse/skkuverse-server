/**
 * Characterization of the `bus_cache` read path over a real `mongod`
 * (harden-test-suite task 6.3, design D6), in the production topology: a poller
 * process writes what it fetched to `bus_cache`, and an api replica, whose own
 * pollers never run, serves the realtime and station routes from it.
 *
 * Each test boots two apps on one mongod, both with ROLE=api so no poller
 * starts on its own: a "poller" app, booted under a spy on
 * PollerRegistryService#registerPoller so the test runs a registered poller's
 * tick by name, and an "api" app. Each boots every bus module `src/app.module.ts`
 * imports, so a module split needs no edit here, and overrides only `Clock`, which
 * stands at 10:00 KST on Tuesday 2026-10-20. Upstream APIs (HSSC, TOPIS) are a
 * loopback server reached through an axios request interceptor; their payloads
 * are hand-written in the shapes the pollers read (the client fixtures are task
 * 6.6). The 5-second test also freezes `Date`, which `createCachedLoader`
 * (src/infra/cached-loader.ts) reads for its TTL.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`).
 */
import http from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Collection } from "mongodb";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { LoopbackServers } from "../../helpers/nest/loopback-servers";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Axios = import("axios").AxiosStatic;
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];

const NOW = new Date("2026-10-20T01:00:00Z");
const CLOCK = { now: (): Date => new Date(NOW) };
const DO_NOT_FAKE = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "nextTick",
  "performance",
] as const;

const HSSC_ITEMS = [
  { line_no: "1", inout: "LEFT", stop_no: "3", seq: "6", stop_name: "농구장정류소", get_date: "2026-10-20 오전 9:59:30" },
  { line_no: "2", inout: "ENTERED", stop_no: "9", seq: "1", stop_name: "혜화역 1번출구 셔틀버스 정류소", get_date: "2026-10-20 오전 9:58:00" },
];
const TOPIS_OK = { headerCd: "0", headerMsg: "정상적으로 처리되었습니다.", itemCount: 0 };
const STATION_BODY = { msgHeader: TOPIS_OK, msgBody: { itemList: [{ arrmsg1: "3분후[2번째 전]", stId: "100000018" }] } };
const JONGRO07_LOC_BODY = {
  msgHeader: TOPIS_OK,
  msgBody: {
    itemList: [
      { lastStnId: "100900197", tmX: "126.998", tmY: "37.587", plainNo: "서울74사5537", busType: "1" },
      { lastStnId: "999999999", tmX: "126.990", tmY: "37.580", plainNo: "서울74사0001", busType: "1" },
    ],
  },
};
const JONGRO07_LIST_BODY = {
  msgHeader: TOPIS_OK,
  msgBody: {
    itemList: [
      { stId: "100900220", staOrd: "1", stNm: "성균관대운동장", plainNo1: "서울74사5537", mkTm: "2026-10-20 09:59:00.0", arsId: "01617", arrmsg1: "3분후[2번째 전]" },
      { stId: "100900221", staOrd: "2", stNm: "학생회관", plainNo1: "서울74사5537", mkTm: "2026-10-20 09:59:00.0", arsId: "01618", arrmsg1: "5분후[3번째 전]" },
      { stId: "100000424", staOrd: "3", stNm: "비천당", plainNo1: " ", mkTm: "2026-10-20 09:59:00.0", arsId: "01619", arrmsg1: "" },
    ],
  },
};

/** What each upstream answers, by host and path; set per test. */
const upstream = { hssc: HSSC_ITEMS as unknown, station: STATION_BODY as unknown, requests: [] as string[] };

function upstreamApi(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? "";
  upstream.requests.push(url);
  const body = url.startsWith("/test-hssc/")
    ? upstream.hssc
    : url.startsWith("/test-station/")
      ? upstream.station
      : url.includes("/buspos/") && url.includes("busRouteId=100900004")
        ? JONGRO07_LOC_BODY
        : url.includes("/arrive/") && url.includes("busRouteId=100900004")
          ? JONGRO07_LIST_BODY
          : { msgHeader: { headerCd: "4", headerMsg: "결과가 없습니다." }, msgBody: { itemList: null } };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const servers = new LoopbackServers();
let mongod: TestMongod;
let db: Db;
let config: Config;
let axios: Axios;
let interceptor: number;
let buildTestApp: BuildTestApp;
let PollerRegistryService: Registry;
let busCache: Collection;
let pollers: Map<string, () => Promise<unknown> | unknown>;
let pollerApp: NestExpressApplication;
let apiApp: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  const api = await servers.serve(upstreamApi);
  const port = (api.address() as { port: number }).port;

  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  axios = (require("axios") as { default: Axios }).default;
  interceptor = axios.interceptors.request.use((outgoing) => {
    const original = new URL(outgoing.url as string);
    outgoing.url = `http://127.0.0.1:${port}/${original.host}${original.pathname}${original.search}`;
    return outgoing;
  });
  buildTestApp = (require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp }).buildTestApp;
  PollerRegistryService = (require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry })
    .PollerRegistryService;
  busCache = db.getClient().db(config.mongo.dbName).collection(config.mongo.collections.busCache);
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    axios?.interceptors.request.eject(interceptor);
    await servers.closeAll();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  upstream.hssc = HSSC_ITEMS;
  upstream.station = STATION_BODY;
  upstream.requests = [];
  await clearCollections(db.getClient().db(config.mongo.dbName));
  const registered = jest.spyOn(PollerRegistryService.prototype, "registerPoller");
  try {
    pollerApp = await bootApp();
    pollers = new Map(registered.mock.calls.map(([fn, , name]) => [name, fn]));
  } finally {
    registered.mockRestore();
  }
  apiApp = await bootApp();
}, APP_BOOT_TIMEOUT_MS);

afterEach(async () => {
  jest.useRealTimers();
  await apiApp?.close();
  await pollerApp?.close();
});

function bootApp(): Promise<NestExpressApplication> {
  return buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role: "api",
  });
}

async function tick(name: string): Promise<void> {
  const poller = pollers.get(name);
  if (!poller) throw new Error(`no poller registered as ${name}: ${[...pollers.keys()].join(", ")}`);
  await poller();
}

function get(path: string): request.Test {
  return request(apiApp.getHttpServer()).get(path);
}

describe("bus_cache between a poller process and an api replica", () => {
  it("registers the realtime pollers under the names the registry reports", () => {
    // Assert
    expect([...pollers.keys()].filter((n) => !n.startsWith("shuttle-eta")).sort()).toEqual([
      "hssc",
      "jongro-02",
      "jongro-07",
      "jongro-08",
      "station",
    ]);
  });

  it("stores an HSSC tick under `hssc` and the api replica serves it on /bus/realtime/data/hssc", async () => {
    // Act
    await tick("hssc");
    const res = await get("/bus/realtime/data/hssc");

    // Assert
    expect(await busCache.findOne({ _id: "hssc" as never })).toEqual({
      _id: "hssc",
      _updatedAt: NOW,
      data: [
        {
          ...HSSC_ITEMS[0],
          sequence: "2",
          stationName: "농구장 (셔틀버스정류소)",
          carNumber: "0000",
          eventDate: "2026-10-20 09:59:30",
          estimatedTime: 30,
          isLastBus: false,
        },
        {
          ...HSSC_ITEMS[1],
          sequence: "8",
          stationName: "혜화역 1번출구 (셔틀버스정류소)",
          carNumber: "0000",
          eventDate: "2026-10-20 09:58:00",
          estimatedTime: 120,
          isLastBus: false,
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      meta: { lang: "ko", currentTime: "10:00 AM", totalBuses: 2 },
      data: {
        groupId: "hssc",
        buses: [
          { stationIndex: 1, carNumber: "0000", estimatedTime: 30 },
          { stationIndex: 7, carNumber: "0000", estimatedTime: 120 },
        ],
        stationEtas: [],
      },
    });
  });

  it("stores an empty HSSC tick as [] and serves no buses", async () => {
    // Arrange
    upstream.hssc = [];

    // Act
    await tick("hssc");
    const res = await get("/bus/realtime/data/hssc");

    // Assert
    expect(await busCache.findOne({ _id: "hssc" as never })).toEqual({ _id: "hssc", _updatedAt: NOW, data: [] });
    expect(res.body.data.buses).toEqual([]);
  });

  it("stores TOPIS station and HSSC ticks under `station` and `hssc` and composes /bus/station/01592 from both", async () => {
    // Act
    await tick("station");
    await tick("hssc");
    const res = await get("/bus/station/01592");

    // Assert
    expect(await busCache.findOne({ _id: "station" as never })).toEqual({
      _id: "station",
      _updatedAt: NOW,
      data: "3분후[2번째 전]",
    });
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko", totalCount: 2 });
    expect(res.body.data).toEqual([
      {
        busNm: "종로07",
        busSupportTime: true,
        msg1ShowMessage: true,
        msg1Message: "3분후[2번째 전]",
        msg1RemainStation: null,
        msg1RemainSeconds: null,
        msg2ShowMessage: false,
        msg2Message: null,
        msg2RemainStation: null,
        msg2RemainSeconds: null,
      },
      {
        busNm: "인사캠셔틀",
        busSupportTime: false,
        msg1ShowMessage: true,
        msg1Message: "4 정거장 전",
        msg1RemainStation: null,
        msg1RemainSeconds: null,
        msg2ShowMessage: true,
        msg2Message: null,
        msg2RemainStation: null,
        msg2RemainSeconds: null,
      },
    ]);
  });

  it("stores a Jongro tick under jongro_locations_07 and jongro_stations_07 and serves both on /bus/realtime/data/jongro07", async () => {
    // Act
    await tick("jongro-07");
    const res = await get("/bus/realtime/data/jongro07");

    // Assert
    expect((await busCache.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id).sort()).toEqual([
      "jongro_locations_07",
      "jongro_stations_07",
    ]);
    expect(res.body.data).toEqual({
      groupId: "jongro07",
      buses: [{ stationIndex: 5, carNumber: "5537", estimatedTime: 0, latitude: "37.587", longitude: "126.998" }],
      stationEtas: [
        { stationIndex: 0, eta: "3분후[2번째 전]" },
        { stationIndex: 1, eta: "5분후[3번째 전]" },
      ],
    });
  });

  it("serves the api replica's own empty poller memory when bus_cache holds nothing", async () => {
    // Act
    const [hssc, jongro, station] = await Promise.all([
      get("/bus/realtime/data/hssc"),
      get("/bus/realtime/data/jongro07"),
      get("/bus/station/01592"),
    ]);

    // Assert
    expect(hssc.body.data).toEqual({ groupId: "hssc", buses: [], stationEtas: [] });
    expect(jongro.body.data).toEqual({ groupId: "jongro07", buses: [], stationEtas: [] });
    expect(station.body.data.map((s: { msg1Message: string }) => s.msg1Message)).toEqual(["정보 없음", "도착 정보 없음"]);
    expect(upstream.requests).toEqual([]);
  });

  it("keeps a bus_cache read in replica memory for 5 seconds", async () => {
    // Arrange
    jest.useFakeTimers({ now: NOW, doNotFake: [...DO_NOT_FAKE] });
    await get("/bus/realtime/data/hssc");
    await tick("hssc");

    // Act
    const sameInstant = await get("/bus/realtime/data/hssc");
    jest.setSystemTime(NOW.getTime() + 4_999);
    const justBefore = await get("/bus/realtime/data/hssc");
    jest.setSystemTime(NOW.getTime() + 5_000);
    const atExpiry = await get("/bus/realtime/data/hssc");

    // Assert
    expect([sameInstant, justBefore, atExpiry].map((r) => r.body.meta.totalBuses)).toEqual([0, 0, 2]);
  });
});
