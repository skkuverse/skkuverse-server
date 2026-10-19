/**
 * Characterization of the live ETA tick's bus-lane estimates (move-reference-datasets
 * task 2.3, design D14): every live value one `shuttle-eta-live` tick stores in
 * `shuttle_eta`, with its travel model and corridor diagnostics, the probe spans it
 * records in `bus_lane_spans`, and the points it sends NAVER and the routes it asks
 * TOPIS for. The app boots every module `src/app.module.ts` imports under
 * `src/scheduling/` and `src/bus/` as the poller, over a real `mongod`, with the
 * upstream clients replaced by scripted fakes (__tests__/helpers/bus/bus-poller-app.ts) and a fixed `Clock`; the poller
 * registry is spied on, so the test runs the live tick itself.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The
 * expected values were pinned while the corridor was the committed
 * src/bus/eta/lane/bus-lane.json, of which revision 1 of `bus-lane-corridor`
 * (fixtures/bus-lane-corridor.dataset.json) is a copy.
 *
 * The timetable is synthetic: one Friday pattern of `campus-inja` with a 14:00
 * `hakbu` run, inside the lane hours, and a 21:30 `regular` run, past them, which
 * the committed timetable has none of. The day is Friday 2026-10-23, neither a
 * public holiday nor a rest day; the content database holds revision 1 of the
 * schedule content datasets. Three cases, each on a fresh app:
 *
 *   - the 14:00 run: the tick at 12:50 primes the probe, and the tick at 13:00
 *     opens the run's window with a bus on each probe route ten minutes past its
 *     12:50 position, which covers most of the corridor leg: a bus-lane value;
 *   - the 21:30 run at 20:30: a car run, so no probe request and no travel model;
 *   - the 14:00 run at 13:00 with every position request failing: the car route
 *     is stored with travel model `car`, then the tick rejects.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Db as MongoDb } from "mongodb";
import { BusEtaDirectionsError } from "../../../src/bus/eta/bus-eta.error";
import type { LanePosition } from "../../../src/bus/eta/probe/bus-eta-probe.types";
import { FakeBusEtaProbeClient } from "../../helpers/fakes/bus/bus-eta-probe.client.fake";
import { FakeBusEtaTravelClient } from "../../helpers/fakes/bus/bus-eta-travel.client.fake";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const { buildDocuments, parseTimetableFile } = require("../../../scripts/lib/campus-schedule-file");
const store = require("../../../scripts/lib/datasets/store");

type BuildBusPollerApp = typeof import("../../helpers/bus/bus-poller-app")["buildBusPollerApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type Registry = typeof import("../../../src/scheduling/poller-registry.service")["PollerRegistryService"];
type ScheduleContentHelpers = typeof import("../../helpers/bus/schedule-content");

const at = (hhmm: string, seconds = 0): Date => new Date(new Date(`2026-10-23T${hhmm}:00+09:00`).getTime() + seconds * 1000);

const TIMETABLE = {
  semester: "2026-2",
  effectiveFrom: "2026-08-31",
  routeTypes: ["regular", "hakbu"],
  patterns: [
    {
      patternId: "friday",
      days: [5],
      serviceIds: ["campus-inja"],
      entries: [
        { time: "14:00", routeType: "hakbu", busCount: 1, notes: null, stopTimes: ["14:00", null] },
        { time: "21:30", routeType: "regular", busCount: 1, notes: null, stopTimes: ["21:30", null] },
      ],
    },
  ],
};

const STOPS = [
  { lat: 37.587367, lng: 126.993643 },
  { lat: 37.292298, lng: 126.975057 },
];
const ENTRY = { lat: 37.512474, lng: 127.015177 };
const EXIT = { lat: 37.292547, lng: 127.102684 };
const ROUTE_TIMES = { stopOffsetsSec: [0, 4380], legsSec: [900, 2400, 1080] };
const CAR_OFFSETS_SEC = [0, 5040];
const PROBE_ROUTE_IDS = ["200000205", "228000174", "228000175"];

// One southbound bus per probe route, on the corridor centerline, in a section of that route's southbound range.
// Ten minutes later each is about 7 km further south: about 42 km/h.
const POSITIONS_1250: Record<string, LanePosition[]> = {
  "200000205": [{ vehId: "8800-1", lat: 37.512052, lng: 127.015332, sectOrd: 46, dataTm: at("12:49", 15) }],
  "228000174": [{ vehId: "5000-1", lat: 37.448212, lng: 127.054112, sectOrd: 77, dataTm: at("12:49", 15) }],
  "228000175": [{ vehId: "5005-1", lat: 37.388798, lng: 127.102302, sectOrd: 68, dataTm: at("12:49", 15) }],
};
const POSITIONS_1300: Record<string, LanePosition[]> = {
  "200000205": [{ vehId: "8800-1", lat: 37.455513, lng: 127.047499, sectOrd: 49, dataTm: at("12:59", 15) }],
  "228000174": [{ vehId: "5000-1", lat: 37.397689, lng: 127.10061, sectOrd: 80, dataTm: at("12:59", 15) }],
  "228000175": [{ vehId: "5005-1", lat: 37.32589, lng: 127.103519, sectOrd: 72, dataTm: at("12:59", 15) }],
};

let mongod: TestMongod;
let db: Db;
let config: Config;
let buildBusPollerApp: BuildBusPollerApp;
let PollerRegistryService: Registry;
let busDb: MongoDb;
let content: MongoDb;
let app: NestExpressApplication | undefined;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  buildBusPollerApp = (require("../../helpers/bus/bus-poller-app") as { buildBusPollerApp: BuildBusPollerApp }).buildBusPollerApp;
  PollerRegistryService = (require("../../../src/scheduling/poller-registry.service") as { PollerRegistryService: Registry }).PollerRegistryService;
  busDb = db.getClient().db(config.mongo.dbName);
  await busDb.collection("bus_schedules").insertMany(buildDocuments(parseTimetableFile(TIMETABLE)));
  content = db.getClient().db(config.content.dbName);
  const { restDaysFixture, serviceNoticesFixture } = require("../../helpers/bus/schedule-content") as ScheduleContentHelpers;
  const storedBy = { by: "characterization@example.com", now: at("00:00") };
  await store.create(content, "bus-service-notices", serviceNoticesFixture(), storedBy);
  await store.create(content, "skku-rest-days", restDaysFixture(), storedBy);
}, MONGOD_START_TIMEOUT_MS);

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
  await busDb.collection("shuttle_eta").deleteMany({});
  await busDb.collection("bus_lane_spans").deleteMany({});
});

afterAll(async () => {
  try {
    await clearCollections(busDb);
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

interface LivePoller {
  naver: FakeBusEtaTravelClient;
  topis: FakeBusEtaProbeClient;
  tickAt(now: Date): Promise<unknown>;
}

/** Boots the poller app and returns its `shuttle-eta-live` tick at a given instant, over scripted NAVER and TOPIS. */
async function bootLivePoller(): Promise<LivePoller> {
  const ticks = new Map<string, () => unknown>();
  jest.spyOn(PollerRegistryService.prototype, "registerPoller").mockImplementation((fn, _intervalMs, name) => {
    ticks.set(name, fn);
  });
  let now = at("00:00");
  const naver = new FakeBusEtaTravelClient();
  naver.routeTimes = ROUTE_TIMES;
  naver.offsetsSec = CAR_OFFSETS_SEC;
  const topis = new FakeBusEtaProbeClient();
  app = await buildBusPollerApp({ naver, topis, clock: { now: () => now } });
  const tick = ticks.get("shuttle-eta-live");
  if (!tick) throw new Error("shuttle-eta-live was not registered");
  return {
    naver,
    topis,
    tickAt: async (instant) => {
      now = instant;
      return tick();
    },
  };
}

const setPositions = (topis: FakeBusEtaProbeClient, positions: Record<string, LanePosition[]>): void => {
  topis.positionsByRoute = new Map(Object.entries(positions));
};

const storedLiveValues = () => busDb.collection("shuttle_eta").find({ kind: "live" }).sort({ _id: 1 }).toArray();
const storedSpans = () => busDb.collection("bus_lane_spans").find({}).sort({ _id: 1 }).toArray();

describe("the shuttle-eta-live tick on a bus-lane run in its window", () => {
  it("primes the probe at 12:50 and stores the 14:00 hakbu run's bus-lane value at 13:00, with its corridor diagnostics", async () => {
    // Arrange
    const poller = await bootLivePoller();
    setPositions(poller.topis, POSITIONS_1250);
    await expect(poller.tickAt(at("12:50"))).resolves.toEqual({ calls: 0, written: 0 });
    setPositions(poller.topis, POSITIONS_1300);

    // Act
    const result = await poller.tickAt(at("13:00"));

    // Assert
    expect(result).toEqual({ calls: 1, written: 1 });
    expect(await storedLiveValues()).toEqual([
      {
        _id: "campus-inja|hakbu|2026-10-23|14:00|live",
        kind: "live",
        serviceId: "campus-inja",
        routeType: "hakbu",
        date: "2026-10-23",
        time: "14:00",
        departAt: at("14:00"),
        offsetsSec: [0, 4246],
        source: "naver",
        fetchedAt: at("13:00"),
        travel: { model: "busLane", corridorCarSec: 2400, corridorSec: 2266, spanCount: 3, coverage: 0.7942588759275636 },
        expiresAt: new Date("2026-10-31T05:00:00.000Z"),
      },
    ]);
    expect(await storedSpans()).toEqual([
      {
        _id: "200000205|8800-1|2026-10-23T03:49:15.000Z|2026-10-23T03:59:15.000Z",
        routeId: "200000205",
        vehId: "8800-1",
        direction: "southbound",
        fromAlongM: 993.4908464921809,
        toAlongM: 7993.079216989263,
        fromAt: at("12:49", 15),
        toAt: at("12:59", 15),
        speedKmh: 41.9975302229825,
        expiresAt: new Date("2027-01-21T03:59:15.000Z"),
      },
      {
        _id: "228000174|5000-1|2026-10-23T03:49:15.000Z|2026-10-23T03:59:15.000Z",
        routeId: "228000174",
        vehId: "5000-1",
        direction: "southbound",
        fromAlongM: 8993.038405623973,
        toAlongM: 15990.96158753413,
        fromAt: at("12:49", 15),
        toAt: at("12:59", 15),
        speedKmh: 41.987539091460945,
        expiresAt: new Date("2027-01-21T03:59:15.000Z"),
      },
      {
        _id: "228000175|5005-1|2026-10-23T03:49:15.000Z|2026-10-23T03:59:15.000Z",
        routeId: "228000175",
        vehId: "5005-1",
        direction: "southbound",
        fromAlongM: 16990.86639475468,
        toAlongM: 23990.78176748001,
        fromAt: at("12:49", 15),
        toAt: at("12:59", 15),
        speedKmh: 41.999492236351976,
        expiresAt: new Date("2027-01-21T03:59:15.000Z"),
      },
    ]);
    expect(poller.naver.calls.map((call) => call.points)).toEqual([
      [
        { at: STOPS[0], kind: "stop" },
        { at: ENTRY, kind: "via" },
        { at: EXIT, kind: "via" },
        { at: STOPS[1], kind: "stop" },
      ],
    ]);
    expect(poller.topis.calls.map((call) => [call.routeId, call.now])).toEqual([
      ...PROBE_ROUTE_IDS.map((routeId) => [routeId, at("12:50")]),
      ...PROBE_ROUTE_IDS.map((routeId) => [routeId, at("13:00")]),
    ]);
  }, APP_BOOT_TIMEOUT_MS);
});

describe("the shuttle-eta-live tick on a run past the lane hours", () => {
  it("stores the 21:30 run's car value at 20:30, with no travel model and no position request", async () => {
    // Arrange
    const poller = await bootLivePoller();
    setPositions(poller.topis, POSITIONS_1300);

    // Act
    const result = await poller.tickAt(at("20:30"));

    // Assert
    expect(result).toEqual({ calls: 1, written: 1 });
    expect(await storedLiveValues()).toEqual([
      {
        _id: "campus-inja|regular|2026-10-23|21:30|live",
        kind: "live",
        serviceId: "campus-inja",
        routeType: "regular",
        date: "2026-10-23",
        time: "21:30",
        departAt: at("21:30"),
        offsetsSec: CAR_OFFSETS_SEC,
        source: "naver",
        fetchedAt: at("20:30"),
        expiresAt: new Date("2026-10-31T12:30:00.000Z"),
      },
    ]);
    expect(poller.naver.calls.map((call) => call.points)).toEqual([STOPS]);
    expect(poller.topis.calls).toEqual([]);
  }, APP_BOOT_TIMEOUT_MS);
});

describe("the shuttle-eta-live tick when the position requests fail", () => {
  it("stores the 14:00 run's car-route value with travel model car at 13:00, then rejects with the TOPIS error", async () => {
    // Arrange
    const poller = await bootLivePoller();
    const outage = new BusEtaDirectionsError("topis", "http", "HTTP 503", 503);
    poller.topis.failWith = outage;

    // Act
    const outcome = await Promise.resolve(poller.tickAt(at("13:00"))).then(
      () => null,
      (err: unknown) => err,
    );

    // Assert
    expect(outcome).toBe(outage);
    expect(await storedLiveValues()).toEqual([
      {
        _id: "campus-inja|hakbu|2026-10-23|14:00|live",
        kind: "live",
        serviceId: "campus-inja",
        routeType: "hakbu",
        date: "2026-10-23",
        time: "14:00",
        departAt: at("14:00"),
        offsetsSec: CAR_OFFSETS_SEC,
        source: "naver",
        fetchedAt: at("13:00"),
        travel: { model: "car" },
        expiresAt: new Date("2026-10-31T05:00:00.000Z"),
      },
    ]);
    expect(poller.naver.calls.map((call) => call.points)).toEqual([
      [
        { at: STOPS[0], kind: "stop" },
        { at: ENTRY, kind: "via" },
        { at: EXIT, kind: "via" },
        { at: STOPS[1], kind: "stop" },
      ],
      STOPS,
    ]);
    expect(poller.topis.calls.map((call) => call.routeId).sort()).toEqual(PROBE_ROUTE_IDS);
  }, APP_BOOT_TIMEOUT_MS);
});
