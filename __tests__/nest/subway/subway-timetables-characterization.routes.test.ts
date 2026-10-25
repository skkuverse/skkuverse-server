/**
 * Characterization of what the subway timetables serve (ADR 0011, D6): the arrivals route's timetable-only answers and one
 * tracker tick's written arrivals. Each must stay the same when the tables move
 * from committed files to the `subway-timetables` dataset.
 *
 * The app boots every module `src/app.module.ts` imports under
 * `src/scheduling/` and `src/subway/`, as an api replica, through the
 * production pipeline with only `Clock` overridden. It runs over a real
 * `mongod` whose content database holds revision 1 of `subway-topology` and
 * of `subway-station-coords` (stored through the tool's own
 * scripts/lib/datasets/store.js) and revision 1
 * of `subway-timetables`: the trimmed fixture, stored through scripts/lib/datasets/parts.js; whose
 * `public_holidays` holds 2026 with Christmas, and whose `subway_arrivals`
 * starts empty, so every platform is served from its timetable alone.
 *
 * - For every served station in `ko`, `en` and `zh`, at a weekday 08:00
 *   (Wednesday 2026-10-21), a Saturday 14:00 (2026-10-24), a public holiday
 *   11:00 (Friday 2026-12-25) and a weekday 00:20 (Wednesday 2026-10-21, the
 *   service day of Tuesday), `GET /subway/stations/:id/arrivals` answers the
 *   status, `Cache-Control`, `Vary`, `ETag` and bytes the code answered from
 *   the committed timetables.
 * - At the weekday 08:00, one tick of SubwayTrackingService over fixed
 *   observations (each line's trains departing a stop before each served
 *   platform, a minute late; the Shinbundang ones as trainsets; one 4호선
 *   countdown) writes the `subway_arrivals` documents it wrote then.
 *
 * Every expected value is fixtures/subway-timetables-characterization.golden.json,
 * generated from today's code at commit 2198cf04. A regression pin: a failure
 * is a regression to report, and an expected value changes only with the
 * behavior it pins (`.claude/rules/tests.md`).
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import type { PublicHolidaysDoc } from "../../../src/calendar/calendar.document";
import type { SubwayArrivalsDoc } from "../../../src/subway/subway.document";
import type { ProviderObservations, TrainEvent } from "../../../src/subway/subway.types";
import type { SubwayTrackingService } from "../../../src/subway/tracking/subway-tracking.service";
import { APP_BOOT_TIMEOUT_MS, MONGOD_START_TIMEOUT_MS, assertConfigReaches, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";
import golden from "./fixtures/subway-timetables-characterization.golden.json";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";

// scripts/ is plain CommonJS outside tsconfig, so require rather than import.
const store = require("../../../scripts/lib/datasets/store");

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");
type TopologyHelpers = typeof import("../../helpers/subway/topology");
type TimetableHelpers = typeof import("../../helpers/subway/timetables");
type StationCoordsHelpers = typeof import("../../helpers/subway/station-coords");
type TrackingModule = typeof import("../../../src/subway/tracking/subway-tracking.service");

type Lang = "ko" | "en" | "zh";
const LANGS: Lang[] = ["ko", "en", "zh"];
const STATION_IDS = ["sungkyunkwan", "hyehwa", "jeongja", "jamsil", "dogok", "gangnam", "yangjae", "gwanggyo-jungang"] as const;
type StationId = (typeof STATION_IDS)[number];

const SEEDED_AT = new Date("2026-10-20T03:00:00.000Z");
const TICK_AT = golden.tick.at;
let clockAt = SEEDED_AT;
const CLOCK: Clock = { now: () => new Date(clockAt) };

const HOLIDAYS_2026: PublicHolidaysDoc = {
  _id: 2026,
  holidays: [
    { date: "2026-10-03", name: "개천절" },
    { date: "2026-10-09", name: "한글날" },
    { date: "2026-12-25", name: "기독탄신일" },
  ],
  fetchedAt: SEEDED_AT,
};

const departed = (trainNo: string, platformId: string, at: string, destination: string, extra: Partial<TrainEvent> = {}): TrainEvent => ({
  trainNo,
  platformId,
  state: "departed",
  stateChangedAt: new Date(at),
  destination,
  ...extra,
});

// Each served platform's direction: a train that left the stop before it a minute late; on 신분당선 under a trainset
// number, which run matching renumbers.
const OBSERVATIONS: ProviderObservations = {
  source: "characterization",
  events: [
    departed("0426", "KR-1-P154", "2026-10-20T22:53:00.000Z", "광운대"),
    departed("0417", "KR-1-P152", "2026-10-20T22:53:30.000Z", "서동탄"),
    departed("4402", "S1-4-421", "2026-10-20T22:58:00.000Z", "불암산"),
    departed("4031", "S1-4-419", "2026-10-20T22:59:30.000Z", "사당"),
    departed("6050", "KR-K1-K231", "2026-10-20T22:58:00.000Z", "왕십리"),
    departed("6303", "KR-K1-K229", "2026-10-20T22:59:30.000Z", "고색"),
    departed("6038", "KR-K1-K218", "2026-10-20T22:58:30.000Z", "왕십리"),
    departed("6039", "KR-K1-K216", "2026-10-20T22:58:30.000Z", "죽전"),
    departed("2094", "S1-2-215", "2026-10-20T22:58:00.000Z", "내선순환"),
    departed("2049", "S1-2-217", "2026-10-20T22:57:30.000Z", "외선순환"),
    departed("2086", "S1-2-221", "2026-10-20T22:58:00.000Z", "내선순환"),
    departed("2057", "S1-2-223", "2026-10-20T22:57:30.000Z", "외선순환"),
    departed("8058", "S1-8-2816", "2026-10-20T22:58:30.000Z", "별내"),
    departed("8039", "S1-8-2814", "2026-10-20T22:56:10.000Z", "모란"),
    departed("3088", "S1-3-335", "2026-10-20T22:56:30.000Z", "대화"),
    departed("3037", "S1-3-333", "2026-10-20T22:58:00.000Z", "오금"),
    departed("3086", "S1-3-333", "2026-10-20T22:56:00.000Z", "구파발"),
    departed("3039", "S1-3-331", "2026-10-20T22:57:00.000Z", "오금"),
    departed("5146", "DX-D1-D13", "2026-10-20T22:59:00.000Z", "신사", { reportedDirection: "up" }),
    departed("5129", "DX-D1-4311", "2026-10-20T22:58:00.000Z", "광교", { reportedDirection: "down" }),
    departed("5136", "DX-D1-4308", "2026-10-20T22:58:00.000Z", "신사", { reportedDirection: "up" }),
    departed("5137", "DX-D1-4306", "2026-10-20T22:59:00.000Z", "광교", { reportedDirection: "down" }),
    departed("5135", "DX-D1-4307", "2026-10-20T22:58:00.000Z", "광교", { reportedDirection: "down" }),
    departed("5152", "DX-D1-4319", "2026-10-20T22:56:00.000Z", "신사", { reportedDirection: "up" }),
    departed("5123", "DX-D1-4317", "2026-10-20T22:59:00.000Z", "광교", { reportedDirection: "down" }),
  ],
  countdownRows: [{ trainNo: "4402", platformId: "S1-4-420", generatedAt: new Date("2026-10-20T22:59:30.000Z"), remainingSec: 120 }],
};

type Answer = { status: number; cacheControl: string; vary: string; etag: string; body: unknown };

let mongod: TestMongod;
let db: Db;
let config: Config;
let app: NestExpressApplication;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const main = db.getClient().db(config.mongo.dbName);
  await main.collection<PublicHolidaysDoc>(config.holidays.collections.publicHolidays).insertOne(HOLIDAYS_2026);
  const { subwayTopologyFixture } = require("../../helpers/subway/topology") as TopologyHelpers;
  const content = db.getClient().db(config.content.dbName);
  await store.create(content, "subway-topology", subwayTopologyFixture(), { by: "characterization@example.com", now: SEEDED_AT });
  const { stationCoordsFixture } = require("../../helpers/subway/station-coords") as StationCoordsHelpers;
  await store.create(content, "subway-station-coords", stationCoordsFixture(), { by: "characterization@example.com", now: SEEDED_AT });
  const { storeSubwayTimetablesFixture } = require("../../helpers/subway/timetables") as TimetableHelpers;
  await storeSubwayTimetablesFixture(content, { by: "characterization@example.com", now: SEEDED_AT });
}, MONGOD_START_TIMEOUT_MS);

beforeAll(async () => {
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/subway/"),
    overrides: [{ provide: RateLimitPolicy, useValue: new FakeRateLimitPolicy() }, { provide: Clock, useValue: CLOCK }],
    role: "api",
  });
}, APP_BOOT_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

const INSTANTS = Object.keys(golden.instants) as Array<keyof typeof golden.instants>;

describe.each(INSTANTS)("GET /subway/stations/:stationId/arrivals at %s, timetable only", (instant) => {
  beforeAll(() => {
    clockAt = new Date(instant);
  });

  it.each(LANGS.flatMap((lang) => STATION_IDS.map((stationId) => [lang, stationId] as const)))(
    "answers in %s for %s the bytes and headers the committed timetables gave",
    async (lang, stationId) => {
      // Arrange
      const expected = (golden.instants[instant] as Record<StationId, Record<Lang, Answer>>)[stationId][lang];

      // Act
      const res = await request(app.getHttpServer()).get(`/subway/stations/${stationId}/arrivals`).set("Accept-Language", lang);

      // Assert
      expect(res.status).toBe(expected.status);
      expect(res.body).toEqual(expected.body);
      expect(res.text).toBe(JSON.stringify(expected.body));
      expect(res.headers["cache-control"]).toBe(expected.cacheControl);
      expect(res.headers.vary).toBe(expected.vary);
      expect(res.headers.etag).toBe(expected.etag);
    },
  );
});

describe("SubwayTrackingService.track at a weekday 08:00 over fixed observations", () => {
  it("writes every platform's arrivals document the committed timetables gave", async () => {
    // Arrange
    clockAt = new Date(TICK_AT);
    const { SubwayTrackingService: Tracking } = require("../../../src/subway/tracking/subway-tracking.service") as TrackingModule;
    const tracking = app.get<SubwayTrackingService>(Tracking, { strict: false });
    const arrivals = db.getClient().db(config.mongo.dbName).collection<SubwayArrivalsDoc>(config.subway.collections.arrivals);

    // Act
    await tracking.track({ observe: async () => OBSERVATIONS });

    // Assert
    const written = await arrivals.find({}).sort({ _id: 1 }).toArray();
    expect(JSON.parse(JSON.stringify(written))).toEqual(golden.tick.docs);
  });
});
