/**
 * Characterization of the `bus_cache` read path over a real `mongod`
 * (ADR 0011, D6), in the production topology: a poller
 * process writes what it fetched to `bus_cache`, and an api replica, whose own
 * pollers never run, serves the realtime routes from it.
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
 * A tick runs under ROLE=poller: the two apps share one process.env, and the
 * pollers' upstream keys are readable only where pollers run (ADR 0012, D4).
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`).
 */
import http from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Collection } from "mongodb";
import request from "supertest";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import { Clock } from "../../../src/infra/clock";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import { LoopbackServers } from "../../helpers/nest/loopback-servers";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Axios = import("axios").AxiosStatic;
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];
type StoredRoutes = typeof import("../../helpers/bus/bus-registry")["storedJongroRouteDocuments"];
type RouteAttributesHelpers = typeof import("../../helpers/bus/route-attributes");

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
const JONGRO07_LOC_BODY = {
  msgHeader: TOPIS_OK,
  msgBody: {
    itemList: [
      // WHY: vehId, sectOrd, sectDist, fullSectDist, stopFlag and dataTm are getBusPosByRtid fields the client reads
      // since PR #278; their shape follows __tests__/nest/bus/fixtures/topis-jongro-positions.json.
      {
        ...{ lastStnId: "100900197", gpsX: "126.998", gpsY: "37.587", tmX: null, tmY: null, trnstnid: "100900028", plainNo: "서울74사5537", busType: "1" },
        ...{ vehId: "100000103", sectOrd: "6", sectDist: "0.1", fullSectDist: "0.25", stopFlag: "0", dataTm: "20261020095930" },
      },
      {
        ...{ lastStnId: "999999999", gpsX: "126.990", gpsY: "37.580", tmX: null, tmY: null, trnstnid: "100900028", plainNo: "서울74사0001", busType: "1" },
        ...{ vehId: "100000001", sectOrd: "9", sectDist: "0.05", fullSectDist: "0.3", stopFlag: "1", dataTm: "20261020095931" },
      },
    ],
  },
};
// TOPIS's values for a bus slot that names no bus (topis-jongro-arrivals.json).
const NO_BUS = (slot: "1" | "2", arrmsg: string) => ({
  [`vehId${slot}`]: "0",
  [`plainNo${slot}`]: " ",
  [`sectOrd${slot}`]: "0",
  [`traTime${slot}`]: "0",
  [`isLast${slot}`]: "0",
  [`rerdie_Div${slot}`]: "0",
  [`reride_Num${slot}`]: "0",
  [`arrmsg${slot}`]: arrmsg,
});
const BUS_5537 = { vehId1: "100000103", sectOrd1: "0", isLast1: "0", rerdie_Div1: "2", reride_Num1: "9" };
const JONGRO07_LIST_BODY = {
  msgHeader: TOPIS_OK,
  msgBody: {
    itemList: [
      { ...BUS_5537, ...NO_BUS("2", "출발대기"), stId: "100900220", staOrd: "1", stNm: "성균관대운동장", plainNo1: "서울74사5537", traTime1: "180", mkTm: "2026-10-20 09:59:00.0", arsId: "01617", arrmsg1: "3분후[2번째 전]" },
      { ...BUS_5537, ...NO_BUS("2", "출발대기"), stId: "100900221", staOrd: "2", stNm: "학생회관", plainNo1: "서울74사5537", traTime1: "300", mkTm: "2026-10-20 09:59:00.0", arsId: "01618", arrmsg1: "5분후[3번째 전]" },
      { ...NO_BUS("1", ""), ...NO_BUS("2", ""), stId: "100000424", staOrd: "3", stNm: "비천당", plainNo1: " ", mkTm: "2026-10-20 09:59:00.0", arsId: "01619", arrmsg1: "" },
    ],
  },
};

/** What each upstream answers, by host and path; set per test. */
const upstream = { hssc: HSSC_ITEMS as unknown, requests: [] as string[] };

function upstreamApi(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = req.url ?? "";
  upstream.requests.push(url);
  const body = url.startsWith("/test-hssc/")
    ? upstream.hssc
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
  // WHY: the Jongro realtime groups read each route's seat count from revision 1 of jongro-route-attributes,
  // stored as `npm run data` stores it (ADR 0013, D2).
  const store = require("../../../scripts/lib/datasets/store");
  const { routeAttributesFixture } = require("../../helpers/bus/route-attributes") as RouteAttributesHelpers;
  await store.create(db.getClient().db(config.content.dbName), "jongro-route-attributes", routeAttributesFixture(), { by: "characterization@example.com", now: NOW });
  // WHY: the live route names each station's stop from bus-stops (ADR 0019, D5), stored as `npm run data` stores it.
  const { busStopsFixture } = require("../../helpers/bus/bus-stops") as typeof import("../../helpers/bus/bus-stops");
  await store.create(db.getClient().db(config.content.dbName), "bus-stops", busStopsFixture(), { by: "characterization@example.com", now: NOW });
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
  upstream.requests = [];
  await clearCollections(db.getClient().db(config.mongo.dbName));
  // WHY: no boot writes the registry (ADR 0012, D3), so the stored routes are a fixture.
  const storedJongroRouteDocuments = (require("../../helpers/bus/bus-registry") as { storedJongroRouteDocuments: StoredRoutes }).storedJongroRouteDocuments;
  await db.getClient().db(config.mongo.dbName).collection<JongroRouteDocument>(config.mongo.collections.jongroRoutes).insertMany(storedJongroRouteDocuments(CLOCK.now()));
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
  const role = process.env.ROLE;
  process.env.ROLE = "poller";
  try {
    await poller();
  } finally {
    if (role === undefined) delete process.env.ROLE;
    else process.env.ROLE = role;
  }
}

function get(path: string): request.Test {
  return request(apiApp.getHttpServer()).get(path);
}

describe("bus_cache between a poller process and an api replica", () => {
  it("registers the realtime pollers under the names the registry reports", () => {
    // Assert
    expect([...pollers.keys()].filter((n) => !n.startsWith("shuttle-eta")).sort()).toEqual([
      "hssc",
      "shuttle-gps",
      "shuttle-stop-reports",
      "jongro-02",
      "jongro-07",
      "jongro-08",
      "jongro-path-02",
      "jongro-path-07",
      "jongro-path-08",
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
      // WHY: serverNow is what PR #285 adds to meta, a deliberate pin change.
      meta: { lang: "ko", currentTime: "10:00 AM", totalBuses: 2, serverNow: "2026-10-20T10:00:00+09:00" },
      data: {
        groupId: "hssc",
        buses: [
          // WHY: kind is what PR #278 adds to every bus.
          { stationIndex: 1, carNumber: "0000", estimatedTime: 30, kind: "estimated" },
          { stationIndex: 7, carNumber: "0000", estimatedTime: 120, kind: "estimated" },
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

  it("stores a Jongro tick under jongro_locations_07 and jongro_stations_07 and serves both on /bus/realtime/data/jongro07", async () => {
    // Act
    await tick("jongro-07");
    const res = await get("/bus/realtime/data/jongro07");

    // Assert
    const running5537 = (minutes: number, stopsAway: number, message: string) => ({
      minutes,
      stopsAway,
      state: "running",
      isLastBus: false,
      carNumber: "5537",
      crowding: "relaxed",
      passengerCount: 9,
      message,
    });
    const WAITING_NO_VEHICLE = {
      minutes: null,
      stopsAway: null,
      state: "waiting",
      isLastBus: false,
      carNumber: null,
      crowding: null,
      passengerCount: null,
      message: "출발대기",
    };
    expect((await busCache.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id).sort()).toEqual([
      "jongro_locations_07",
      "jongro_stations_07",
    ]);
    // WHY: the stored arrival rows gained each row's two buses (PR #275); every other
    // field keeps the value it had.
    const bus5537 = { sectOrd: 0, isLast: false, plainNo: "서울74사5537", vehId: "100000103", rerideDiv: 2, rerideNum: 9 };
    const noBus = (staOrd: number, arrmsg: string) => ({
      traTime: 0,
      sectOrd: 0,
      staOrd,
      arrmsg,
      isLast: false,
      plainNo: " ",
      vehId: "0",
      rerideDiv: 0,
      rerideNum: 0,
    });
    expect(await busCache.findOne({ _id: "jongro_stations_07" as never })).toEqual({
      _id: "jongro_stations_07",
      _updatedAt: NOW,
      data: [
        {
          stationId: "100900220",
          sequence: "1",
          stationName: "성균관대운동장",
          carNumber: "5537",
          eventDate: "2026-10-20 09:59:00.0",
          stationNumber: "01617",
          eta: "3분후[2번째 전]",
          buses: [{ ...bus5537, traTime: 180, staOrd: 1, arrmsg: "3분후[2번째 전]" }, noBus(1, "출발대기")],
        },
        {
          stationId: "100900221",
          sequence: "2",
          stationName: "학생회관",
          carNumber: "5537",
          eventDate: "2026-10-20 09:59:00.0",
          stationNumber: "01618",
          eta: "5분후[3번째 전]",
          buses: [{ ...bus5537, traTime: 300, staOrd: 2, arrmsg: "5분후[3번째 전]" }, noBus(2, "출발대기")],
        },
        {
          stationId: "100000424",
          sequence: "3",
          stationName: "비천당",
          carNumber: "----",
          eventDate: "2026-10-20 09:59:00.0",
          stationNumber: "01619",
          eta: "",
          buses: [noBus(3, ""), noBus(3, "")],
        },
      ],
    });
    expect(res.body.data).toEqual({
      groupId: "jongro07",
      // WHY: kind and tracked are what PR #278 adds; crowding is the ord 1 row's, the first
      // naming vehicle 100000103, and no row is its next stop's (ord 7).
      buses: [
        {
          stationIndex: 5,
          carNumber: "5537",
          estimatedTime: 0,
          latitude: "37.587",
          longitude: "126.998",
          kind: "tracked",
          tracked: {
            status: "running",
            vehicleId: "100000103",
            observedAt: "2026-10-20T09:59:30+09:00",
            crowding: "relaxed",
            isLastBus: false,
            progress: 0.4,
            segmentMeters: 250,
            nextStopInSec: null,
            // WHY: trajectory is what PR #285 adds, a deliberate pin change: the observation,
            // then the next stop from its 150 m left at 4 m/s, since no row names the vehicle there.
            trajectory: [
              { at: "2026-10-20T09:59:30+09:00", s: 5.4 },
              { at: "2026-10-20T10:00:08+09:00", s: 6 },
            ],
          },
        },
      ],
      // WHY: each station's arrivals is the field PR #275 adds; eta is as before.
      stationEtas: [
        { stationIndex: 0, eta: "3분후[2번째 전]", arrivals: [running5537(3, 1, "3분후[2번째 전]"), WAITING_NO_VEHICLE] },
        { stationIndex: 1, eta: "5분후[3번째 전]", arrivals: [running5537(5, 2, "5분후[3번째 전]"), WAITING_NO_VEHICLE] },
      ],
      // WHY: the registry's stations version (PR #276), of the routes inserted from __tests__/nest/bus/fixtures/jongro-registry-routes.json.
      stationsVersion: "0346768f2b776f45",
    });
  });

  it("serves no bus when bus_cache holds nothing", async () => {
    // Act
    const [hssc, jongro] = await Promise.all([get("/bus/realtime/data/hssc"), get("/bus/realtime/data/jongro07")]);

    // Assert
    expect(hssc.body.data).toEqual({ groupId: "hssc", buses: [], stationEtas: [] });
    // WHY: stationsVersion is the registry's (PR #276), of the routes inserted from __tests__/nest/bus/fixtures/jongro-registry-routes.json.
    expect(jongro.body.data).toEqual({ groupId: "jongro07", buses: [], stationEtas: [], stationsVersion: "0346768f2b776f45" });
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

// WHY: overnight TOPIS answers "4" (no result) and HSSC an empty array; the pollers write that as an empty
// value, so a key goes missing only when its poller stops writing, which is what bus.cache.missing reports.
describe("bus_cache when the upstreams list no bus", () => {
  const PATHS = ["/bus/realtime/data/hssc", "/bus/realtime/data/jongro02", "/bus/realtime/data/jongro08"];
  const tickAll = async () => {
    for (const name of ["hssc", "jongro-02", "jongro-08"]) await tick(name);
  };

  beforeEach(() => {
    upstream.hssc = [];
  });

  it("writes an empty value under every key", async () => {
    // Act
    await tickAll();

    // Assert
    expect(await busCache.find({}).sort({ _id: 1 }).toArray()).toEqual([
      { _id: "hssc", _updatedAt: NOW, data: [] },
      { _id: "jongro_locations_02", _updatedAt: NOW, data: [] },
      { _id: "jongro_locations_08", _updatedAt: NOW, data: [] },
      { _id: "jongro_stations_02", _updatedAt: NOW, data: [] },
      { _id: "jongro_stations_08", _updatedAt: NOW, data: [] },
    ]);
  });

  it("serves byte for byte what the api replica served with the keys missing", async () => {
    // Arrange
    const missing = await Promise.all(PATHS.map((path) => get(path)));
    await tickAll();
    // WHY: past the replica's 5 s memory of the missing reads.
    jest.setSystemTime(NOW.getTime() + 5_000);

    // Act
    const written = await Promise.all(PATHS.map((path) => get(path)));

    // Assert
    expect(written.map((res) => [res.status, res.headers["cache-control"], res.text])).toEqual(
      missing.map((res) => [res.status, res.headers["cache-control"], res.text]),
    );
  });

  it("logs no bus.cache.missing once the pollers have written", async () => {
    // Arrange
    const logger = require("../../../src/infra/logger") as { warn: (...args: unknown[]) => void };
    const warn = jest.spyOn(logger, "warn");

    try {
      // Act
      await tickAll();
      await Promise.all(PATHS.map((path) => get(path)));

      // Assert
      expect(warn.mock.calls.filter(([fields]) => (fields as { event?: string }).event === "bus.cache.missing")).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

// WHY: add-bus-live-api D14 freezes GET /bus/realtime/data/:groupId, so its body is pinned byte for byte from the
// poller's tick before the live route reshapes what bus_cache keeps (the HSSC layover window, the vehicle plate).
describe("the deprecated realtime route's body, byte for byte", () => {
  const LAYOVER_ITEMS = [
    ...HSSC_ITEMS,
    // A bus laying over at the turnaround for 5 minutes, past the old route's 3-minute window.
    { line_no: "3", inout: "ENTERED", stop_no: "5", seq: "5", stop_name: "농구장정류소", get_date: "2026-10-20 오전 9:55:00" },
    // A bus laying over there for 2 minutes, inside it.
    { line_no: "4", inout: "ENTERED", stop_no: "5", seq: "5", stop_name: "농구장정류소", get_date: "2026-10-20 오전 9:58:00" },
    // A bus 12 minutes past its last event elsewhere, outside the 10-minute window.
    { line_no: "5", inout: "LEFT", stop_no: "8", seq: "8", stop_name: "올림픽기념국민생활관", get_date: "2026-10-20 오전 9:48:00" },
  ];

  it("serves the HSSC buses of a tick with a layover as it did before the live route", async () => {
    // Arrange
    upstream.hssc = LAYOVER_ITEMS;
    await tick("hssc");

    // Act
    const res = await get("/bus/realtime/data/hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(
      '{"meta":{"lang":"ko","currentTime":"10:00 AM","totalBuses":3,"serverNow":"2026-10-20T10:00:00+09:00"},"data":{"groupId":"hssc","buses":[{"stationIndex":1,"carNumber":"0000","estimatedTime":30,"kind":"estimated"},{"stationIndex":7,"carNumber":"0000","estimatedTime":120,"kind":"estimated"},{"stationIndex":0,"carNumber":"0000","estimatedTime":120,"kind":"estimated"}],"stationEtas":[]}}',
    );
  });

  // WHY: the poller keeps a layover for the live route's 15 minutes (ADR 0019, D8); the old route still leaves out past 3.
  it("serves the 5-minute layover the old route leaves out on the live route", async () => {
    // Arrange
    upstream.hssc = LAYOVER_ITEMS;
    await tick("hssc");

    // Act
    const res = await get("/bus/live/hssc");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.vehicles.map((vehicle: { id: string; position: { status: string } }) => [vehicle.id, vehicle.position.status])).toEqual([
      ["1", "inTransit"],
      // WHY: line 2 entered seq 1, a Hyehwa Rotary pass where the shuttle boards no one, so it is passing.
      ["2", "inTransit"],
      ["3", "waitingToDepart"],
      ["4", "waitingToDepart"],
    ]);
  });

  it("serves a Jongno tick as it did before the live route", async () => {
    // Arrange
    await tick("jongro-07");

    // Act
    const res = await get("/bus/realtime/data/jongro07");

    // Assert
    expect(res.status).toBe(200);
    expect(res.text).toBe(
      '{"meta":{"lang":"ko","currentTime":"10:00 AM","totalBuses":1,"serverNow":"2026-10-20T10:00:00+09:00"},"data":{"groupId":"jongro07","buses":[{"stationIndex":5,"carNumber":"5537","estimatedTime":0,"latitude":"37.587","longitude":"126.998","kind":"tracked","tracked":{"status":"running","vehicleId":"100000103","observedAt":"2026-10-20T09:59:30+09:00","crowding":"relaxed","isLastBus":false,"progress":0.4,"segmentMeters":250,"nextStopInSec":null,"trajectory":[{"at":"2026-10-20T09:59:30+09:00","s":5.4},{"at":"2026-10-20T10:00:08+09:00","s":6}]}}],"stationEtas":[{"stationIndex":0,"eta":"3분후[2번째 전]","arrivals":[{"minutes":3,"stopsAway":1,"state":"running","isLastBus":false,"carNumber":"5537","crowding":"relaxed","passengerCount":9,"message":"3분후[2번째 전]"},{"minutes":null,"stopsAway":null,"state":"waiting","isLastBus":false,"carNumber":null,"crowding":null,"passengerCount":null,"message":"출발대기"}]},{"stationIndex":1,"eta":"5분후[3번째 전]","arrivals":[{"minutes":5,"stopsAway":2,"state":"running","isLastBus":false,"carNumber":"5537","crowding":"relaxed","passengerCount":9,"message":"5분후[3번째 전]"},{"minutes":null,"stopsAway":null,"state":"waiting","isLastBus":false,"carNumber":null,"crowding":null,"passengerCount":null,"message":"출발대기"}]}],"stationsVersion":"0346768f2b776f45"}}',
    );
  });
});
