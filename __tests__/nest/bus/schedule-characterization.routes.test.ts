/**
 * Characterization of the shuttle timetable route over a real `mongod`
 * (harden-test-suite task 6.3, design D6): what
 * GET /bus/schedule/data/:serviceId/week answers for timetable patterns
 * (`bus_schedules`) and per-date overrides (`bus_overrides`) seeded the way
 * `npm run schedule` writes them, through the production pipeline with only
 * `Clock` overridden.
 *
 * A regression pin: a failure is a regression to report, and an expected value
 * changes only with the behavior it pins (`.claude/rules/tests.md`). The app
 * boots every bus module `src/app.module.ts` imports, so a module split needs no
 * edit here.
 *
 * `/week` takes its week from `?from=` and refuses one more than a year from
 * today, so `Clock` stands at 10:00 KST on Tuesday 2026-10-20. Each test asks
 * for its own week: ScheduleService keeps a resolved week for an hour per
 * process, which one test pins on purpose.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Collection, Document } from "mongodb";
import request from "supertest";
import { Clock } from "../../../src/infra/clock";
import { MONGOD_START_TIMEOUT_MS, assertConfigReaches, clearCollections, startMongod, type TestMongod } from "../../helpers/mongod";
import { appModulesUnder } from "../../helpers/nest/app-modules";

type BuildTestApp = typeof import("../../helpers/nest/build-test-app")["buildTestApp"];
type Config = typeof import("../../../src/infra/config");
type Db = typeof import("../../../src/infra/db");

const NOW = new Date("2026-10-20T01:00:00Z");
const CLOCK = { now: (): Date => new Date(NOW) };
const SERVICE_NOTICE = { style: "ai", text: "도착 시간은 실시간 교통 상황을 반영해요", source: "service" };

/** Entries in the shape scripts/data/*-schedule.json carries. */
function entries(...times: string[]): Document[] {
  return times.map((time, i) => ({
    index: i + 1,
    time,
    routeType: "regular",
    busCount: 1,
    notes: null,
    stopTimes: [time, null],
  }));
}

let mongod: TestMongod;
let db: Db;
let config: Config;
let app: NestExpressApplication;
let schedules: Collection;
let overrides: Collection;

beforeAll(async () => {
  mongod = await startMongod();
  db = require("../../../src/infra/db") as Db;
  config = require("../../../src/infra/config") as Config;
  assertConfigReaches(mongod, config.mongo.url);
  const { buildTestApp } = require("../../helpers/nest/build-test-app") as { buildTestApp: BuildTestApp };

  const busDb = db.getClient().db(config.mongo.dbName);
  schedules = busDb.collection("bus_schedules");
  overrides = busDb.collection("bus_overrides");
  app = await buildTestApp({
    imports: appModulesUnder("src/scheduling/", "src/bus/"),
    overrides: [{ provide: Clock, useValue: CLOCK }],
    role: "api",
  });
}, MONGOD_START_TIMEOUT_MS);

afterAll(async () => {
  try {
    await app?.close();
    await db?.closeClient();
  } finally {
    await mongod?.stop();
  }
});

beforeEach(async () => {
  await clearCollections(db.getClient().db(config.mongo.dbName));
});

function week(serviceId: string, from: string): request.Test {
  return request(app.getHttpServer()).get(`/bus/schedule/data/${serviceId}/week?from=${from}`);
}

interface Day {
  date: string;
  display: string;
  label: string | null;
  notices: unknown[];
  schedule: Array<{ time: string }>;
}

function byDate(res: request.Response): Record<string, Day> {
  return Object.fromEntries((res.body.data.days as Day[]).map((d) => [d.date, d]));
}

describe("GET /bus/schedule/data/:serviceId/week over seeded patterns and overrides", () => {
  it("resolves a week from Monday to Sunday: overrides on both edge days, patterns between, other services ignored", async () => {
    // Arrange
    await schedules.insertMany([
      { serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], effectiveFrom: "2026-08-31", entries: entries("07:00", "10:00") },
      { serviceId: "campus-inja", patternId: "friday", days: [5], effectiveFrom: "2026-08-31", entries: entries("08:00") },
      { serviceId: "campus-jain", patternId: "weekday", days: [1, 2, 3, 4], effectiveFrom: "2026-08-31", entries: entries("09:30") },
      { serviceId: "campus-jain", patternId: "saturday", days: [6], effectiveFrom: "2026-08-31", entries: entries("11:00") },
    ]);
    await overrides.insertMany([
      { serviceId: "campus-inja", date: "2026-11-09", type: "replace", label: "단축 운행", notices: [{ style: "info", text: "오전만 운행해요" }], entries: entries("07:30") },
      { serviceId: "campus-inja", date: "2026-11-15", type: "replace", label: "특별 운행", notices: [], entries: entries("13:00") },
      { serviceId: "campus-inja", date: "2026-11-16", type: "noService", label: "다음 주", notices: [], entries: [] },
      { serviceId: "campus-jain", date: "2026-11-10", type: "noService", label: "자인 휴무", notices: [], entries: [] },
    ]);

    // Act
    const res = await week("campus-inja", "2026-11-11");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ serviceId: "campus-inja", requestedFrom: "2026-11-11", from: "2026-11-09" });
    const days = byDate(res);
    expect(Object.keys(days)).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
    expect(days["2026-11-09"]).toEqual({
      date: "2026-11-09",
      dayOfWeek: 1,
      display: "schedule",
      label: "단축 운행",
      notices: [SERVICE_NOTICE, { style: "info", text: "오전만 운행해요", source: "override" }],
      schedule: entries("07:30"),
    });
    expect(days["2026-11-10"]).toEqual({
      date: "2026-11-10",
      dayOfWeek: 2,
      display: "schedule",
      label: null,
      notices: [SERVICE_NOTICE],
      schedule: entries("07:00", "10:00"),
    });
    expect(days["2026-11-13"]!.schedule).toEqual(entries("08:00"));
    expect(days["2026-11-14"]).toEqual({ date: "2026-11-14", dayOfWeek: 6, display: "hidden", label: null, notices: [], schedule: [] });
    expect(days["2026-11-15"]).toMatchObject({ dayOfWeek: 7, display: "schedule", label: "특별 운행", schedule: entries("13:00") });
  });

  it("serves a noService override with its own notices only", async () => {
    // Arrange
    await schedules.insertOne({ serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: entries("07:00") });
    await overrides.insertOne({
      serviceId: "campus-inja",
      date: "2026-11-18",
      type: "noService",
      label: "홈 화면의 '축제 인자셔틀'을 확인해 주세요",
      notices: [{ style: "info", text: "축제 기간에는 축제 인자셔틀 시간표로 안내해요" }],
      entries: [],
    });

    // Act
    const res = await week("campus-inja", "2026-11-16");

    // Assert
    expect(byDate(res)["2026-11-18"]).toEqual({
      date: "2026-11-18",
      dayOfWeek: 3,
      display: "noService",
      label: "홈 화면의 '축제 인자셔틀'을 확인해 주세요",
      notices: [{ style: "info", text: "축제 기간에는 축제 인자셔틀 시간표로 안내해요", source: "override" }],
      schedule: [],
    });
    expect(byDate(res)["2026-11-17"]!.schedule).toEqual(entries("07:00"));
  });

  it("switches patterns on their inclusive effective bounds, and the later effectiveFrom wins an overlap", async () => {
    // Arrange
    await schedules.insertMany([
      { serviceId: "campus-inja", patternId: "old", days: [1, 2, 3, 4], effectiveUntil: "2026-11-25", entries: entries("06:00") },
      { serviceId: "campus-inja", patternId: "new", days: [1, 2, 3, 4], effectiveFrom: "2026-11-26", entries: entries("06:30") },
      { serviceId: "campus-inja", patternId: "a-overlap", days: [5], effectiveFrom: "2026-09-01", entries: entries("08:00") },
      { serviceId: "campus-inja", patternId: "b-overlap", days: [5], effectiveFrom: "2026-11-01", entries: entries("08:15") },
    ]);

    // Act
    const res = await week("campus-inja", "2026-11-23");

    // Assert
    const days = byDate(res);
    expect(["2026-11-24", "2026-11-25", "2026-11-26"].map((d) => days[d]!.schedule)).toEqual([
      entries("06:00"),
      entries("06:00"),
      entries("06:30"),
    ]);
    expect(days["2026-11-27"]!.schedule).toEqual(entries("08:15"));
  });

  it("closes a holiday-respecting service on a Korean public holiday and runs one that is not", async () => {
    // Arrange
    const friday = { patternId: "friday", days: [5], entries: entries("08:00") };
    await schedules.insertMany([
      { serviceId: "campus-inja", ...friday },
      { serviceId: "fasttrack-inja", ...friday },
    ]);

    // Act
    const [inja, fasttrack] = await Promise.all([
      week("campus-inja", "2026-12-21"),
      week("fasttrack-inja", "2026-12-21"),
    ]);

    // Assert
    expect(byDate(inja)["2026-12-25"]).toEqual({
      date: "2026-12-25",
      dayOfWeek: 5,
      display: "noService",
      label: "기독탄신일",
      notices: [],
      schedule: [],
    });
    expect(byDate(fasttrack)["2026-12-25"]).toMatchObject({ display: "schedule", schedule: entries("08:00") });
  });

  it("keeps serving a resolved week from memory after the database changes", async () => {
    // Arrange
    await schedules.insertOne({ serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: entries("07:00") });
    const before = await week("campus-inja", "2026-11-30");
    await schedules.updateOne({ patternId: "weekday" }, { $set: { entries: entries("09:00") } });

    // Act
    const after = await week("campus-inja", "2026-12-02");

    // Assert
    expect(byDate(before)["2026-12-01"]!.schedule).toEqual(entries("07:00"));
    expect(byDate(after)["2026-12-01"]!.schedule).toEqual(entries("07:00"));
    expect(after.body.data).toMatchObject({ requestedFrom: "2026-12-02", from: "2026-11-30" });
  });

  it("answers 304 to the ETag it served", async () => {
    // Arrange
    await schedules.insertOne({ serviceId: "campus-inja", patternId: "weekday", days: [1, 2, 3, 4], entries: entries("07:00") });
    const first = await week("campus-inja", "2026-12-07");

    // Act
    const second = await week("campus-inja", "2026-12-07").set("If-None-Match", first.headers.etag as string);

    // Assert
    expect(first.headers.etag).toMatch(/^"week-campus-inja-2026-12-07-[0-9a-f]{32}"$/);
    expect(first.headers["cache-control"]).toBe("public, max-age=300");
    expect(second.status).toBe(304);
  });
});
