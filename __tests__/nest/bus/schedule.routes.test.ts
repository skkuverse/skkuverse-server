/**
 * Integration over the week (BusScheduleController) and smart
 * (BusEtaSmartController) routes on the production pipeline (buildTestApp),
 * with the timetable and estimate stores faked in memory and the clock fixed.
 *
 * Asserts the wire format: envelope shape, 200/404 status + error codes, ETag
 * format regexes ("week-…"/"smart-…"), 304 on If-None-Match, Cache-Control
 * max-age=300 (60 with arrival estimates), i18n message presence/absence per
 * status + en translations, and X-Response-Time present on 200 but ABSENT on
 * 304. The last block applies stored arrival estimates (spec
 * shuttle-arrival-eta) from the faked estimate store.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { SERVICE_CONFIG } from "../../../src/bus/bus.constants";
import type { ShuttleEtaDoc } from "../../../src/bus/eta/bus-eta.document";
import { BusEtaModule } from "../../../src/bus/eta/bus-eta.module";
import { BusEtaRepository } from "../../../src/bus/eta/bus-eta.repository";
import { BusEtaSmartModule } from "../../../src/bus/eta/smart/bus-eta-smart.module";
import { BusModule } from "../../../src/bus/bus.module";
import { BusScheduleModule } from "../../../src/bus/schedule/bus-schedule.module";
import { BusScheduleRepository } from "../../../src/bus/schedule/bus-schedule.repository";
import { BusScheduleService } from "../../../src/bus/schedule/bus-schedule.service";
import { BusStopsModule } from "../../../src/bus/stops/bus-stops.module";
import { Clock } from "../../../src/infra/clock";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { FakeBusEtaRepository } from "../../helpers/fakes/bus/bus-eta.repository.fake";
import { FakeBusScheduleRepository } from "../../helpers/fakes/bus/bus-schedule.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const DO_NOT_FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick", "performance"] as const;
const ENTRY = { index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null };
const pattern = (serviceId: string, days: number[], entries: Array<Record<string, unknown>> = [ENTRY]) => ({ serviceId, patternId: `p-${days.join("")}`, days, entries });

interface TestApp {
  app: NestExpressApplication;
  timetable: FakeBusScheduleRepository;
  estimates: FakeBusEtaRepository;
}

// WHY: the clock reads the (possibly fake-timer) Date, so a test fixes or advances the time with jest.
async function bootApp(): Promise<TestApp> {
  const timetable = new FakeBusScheduleRepository();
  const estimates = new FakeBusEtaRepository();
  const app = await buildTestApp({
    imports: [SchedulingModule, BusModule, BusStopsModule, BusScheduleModule, BusEtaModule, BusEtaSmartModule],
    overrides: [
      { provide: BusScheduleRepository, useValue: timetable },
      { provide: BusEtaRepository, useValue: estimates },
      { provide: Clock, useValue: { now: () => new Date() } },
    ],
    role: "api",
  });
  return { app, timetable, estimates };
}

let app: NestExpressApplication;
let timetable: FakeBusScheduleRepository;
let httpServer: import("http").Server;
let resolveWeek: jest.SpyInstance;
let resolveSmartSchedule: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date("2026-03-10T03:00:00.000Z"), doNotFake: [...DO_NOT_FAKE] });
  ({ app, timetable } = await bootApp());
  timetable.patterns = [pattern("campus-inja", [1, 2, 3, 4, 5])];
  httpServer = app.getHttpServer();
  resolveWeek = jest.spyOn(app.get(BusScheduleService), "resolveWeek");
  resolveSmartSchedule = jest.spyOn(app.get(BusScheduleService), "resolveSmartSchedule");
});

afterEach(async () => {
  SERVICE_CONFIG["campus-inja"]!.suspend = null;
  await app.close();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("GET /bus/schedule/data/:serviceId/week", () => {
  it("returns 200 with correct shape", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serviceId: "campus-inja",
      from: "2026-03-09",
      days: expect.any(Array),
    });
    expect(res.body.data.days).toHaveLength(7);
    expect(res.body.meta.lang).toBe("ko");
    expect(res.headers["x-response-time"]).toMatch(/ms$/);
  });

  it("returns 404 SERVICE_NOT_FOUND for unknown serviceId", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/unknown/week");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  it("returns 400 INVALID_DATE_FORMAT for bad from param", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=bad");

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE_FORMAT");
  });

  it("returns 400 INVALID_DATE_FORMAT for repeated from (?from=A&from=B coercion)", async () => {
    // Act
    const res = await request(httpServer).get(
      "/bus/schedule/data/campus-inja/week?from=2026-03-09&from=2026-03-10",
    );

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE_FORMAT");
  });

  it("response includes ETag header", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.headers.etag).toBeDefined();
  });

  it("returns 304 when If-None-Match matches ETag (no body, no X-Response-Time)", async () => {
    // Arrange
    const res1 = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    const etag = res1.headers.etag;

    // Act
    const res2 = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09")
      .set("If-None-Match", etag);

    // Assert
    expect(res2.status).toBe(304);
    expect(res2.text).toBe("");
    expect(res2.headers["x-response-time"]).toBeUndefined();
  });

  it("sets Cache-Control header", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("ETag format is week-{serviceId}-{from}-{hash}", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");

    // Assert
    expect(res.headers.etag).toMatch(/^"week-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  it("works when from is omitted", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week");

    // Assert
    expect(res.status).toBe(200);
    expect(resolveWeek).toHaveBeenCalledWith("campus-inja", undefined);
  });
});

describe("GET /bus/schedule/data/:serviceId/smart", () => {
  it("returns 200 with selectedDate and no hidden days", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      serviceId: "campus-inja",
      from: "2026-03-09",
      selectedDate: "2026-03-10",
      days: expect.any(Array),
    });
    for (const day of res.body.data.days) {
      expect(day.display).not.toBe("hidden");
    }
    expect(resolveSmartSchedule).toHaveBeenCalledWith("campus-inja");
  });

  it("returns 404 SERVICE_NOT_FOUND for unknown serviceId", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/unknown/smart");

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  it("response includes ETag header with smart- prefix", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    // Arrange
    const res1 = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    const etag = res1.headers.etag;

    // Act
    const res2 = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("If-None-Match", etag);

    // Assert
    expect(res2.status).toBe(304);
  });

  it("sets Cache-Control header: 60 s for a service with arrival estimates, 300 s otherwise", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    const commute = await request(httpServer).get("/bus/schedule/data/commute-jeongja/smart");
    expect(commute.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("ETag format is smart-{serviceId}-{from}-{hash} for active", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  it("suspended response includes i18n message and resumeDate", async () => {
    // Arrange
    SERVICE_CONFIG["campus-inja"]!.suspend = { from: "2026-03-01", until: "2026-08-31" };

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.resumeDate).toBe("2026-09-01");
    expect(res.body.data.days).toHaveLength(0);
  });

  it("noData response includes i18n message", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("noData");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.days).toHaveLength(0);
  });

  it("active response does not include message", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.message).toBeUndefined();
  });

  it("ETag uses status when from is null (suspended)", async () => {
    // Arrange
    SERVICE_CONFIG["campus-inja"]!.suspend = { from: "2026-03-01", until: "2026-08-31" };

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-suspended-[a-f0-9]{32}"$/);
  });

  it("ETag uses status when from is null (noData)", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-noData-[a-f0-9]{32}"$/);
  });

  it("suspended with Accept-Language: en returns English message", async () => {
    // Arrange
    SERVICE_CONFIG["campus-inja"]!.suspend = { from: "2026-03-01", until: "2026-08-31" };

    // Act
    const res = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");

    // Assert
    expect(res.body.data.message).toBe("Service is suspended");
  });

  it("noData with Accept-Language: en returns English message", async () => {
    // Arrange
    timetable.patterns = [];

    // Act
    const res = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");

    // Assert
    expect(res.body.data.message).toBe("Schedule information is being prepared");
  });
});

describe("GET …/smart with arrival estimates", () => {
  let etaApp: NestExpressApplication;
  let server: import("http").Server;
  let etaTimetable: FakeBusScheduleRepository;
  let estimates: FakeBusEtaRepository;
  const FETCHED = new Date("2026-10-12T00:20:00.000Z");

  // A Monday of the 인자셔틀: one regular run at 10:00, stored with null drop-offs.
  const monday = (serviceId: string) =>
    pattern(serviceId, [1], [
      { index: 1, time: "07:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["07:00", null] },
      { index: 2, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] },
    ]);
  const estimate = (source: "live" | "frozen" | "predicted", offsetsSec = [0, 3060], serviceId = "campus-inja"): ShuttleEtaDoc => ({
    _id: `${serviceId}|regular|2026-10-12|10:00|${source === "predicted" ? "baseline" : "live"}`,
    kind: source === "predicted" ? "baseline" : "live",
    serviceId,
    routeType: "regular",
    date: "2026-10-12",
    time: "10:00",
    departAt: new Date("2026-10-12T01:00:00.000Z"),
    offsetsSec,
    source: source === "predicted" ? "tmap" : "naver",
    fetchedAt: FETCHED,
    ...(source === "frozen" ? { frozen: true as const, frozenAt: FETCHED } : {}),
    expiresAt: new Date("2026-10-20T01:00:00.000Z"),
  });
  const store = (...docs: ShuttleEtaDoc[]) => {
    estimates.docs = new Map(docs.map((d) => [d._id, d]));
  };

  beforeEach(async () => {
    await app.close();
    jest.setSystemTime(new Date("2026-10-12T00:30:00.000Z")); // Mon 09:30 KST
    ({ app: etaApp, timetable: etaTimetable, estimates } = await bootApp());
    app = etaApp;
    etaTimetable.patterns = [monday("campus-inja"), monday("commute-jeongja")];
    server = etaApp.getHttpServer();
  });

  it.each(["live", "frozen", "predicted"] as const)("Live entry: fills the drop-offs and names the source (%s)", async (source) => {
    // Arrange
    store(estimate(source));
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");
    const [early, run] = res.body.data.days[0].schedule;

    // Act & Assert
    expect(run.stopTimes).toEqual(["10:00", "10:51"]);
    expect(run.eta).toEqual({ source, updatedAt: "2026-10-12T00:20:00.000Z" });
    expect(early.stopTimes).toEqual(["07:00", null]);
    expect(early).not.toHaveProperty("eta");
  });

  it("New live value: the ETag changes with the estimate, and the header is max-age=60", async () => {
    // Arrange
    store(estimate("live"));
    const first = await request(server).get("/bus/schedule/data/campus-inja/smart");
    // A later live value, read once the 30 s cache and its 10-minute stale window have passed.
    store({ ...estimate("live", [0, 3360]), fetchedAt: new Date("2026-10-12T00:38:00.000Z") });
    jest.setSystemTime(new Date("2026-10-12T00:41:00.000Z"));

    // Act
    const second = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(second.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", "10:56"]);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(second.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("Commute runs carry no estimate: the body and headers are what they were without estimates", async () => {
    // Arrange
    const plain = await request(server).get("/bus/schedule/data/commute-jeongja/smart");
    store(estimate("live", [0, 3060], "commute-jeongja"));

    // Act
    const res = await request(server).get("/bus/schedule/data/commute-jeongja/smart");

    // Assert
    expect(JSON.stringify(res.body.data)).toBe(JSON.stringify(plain.body.data));
    expect(res.headers.etag).toBe(plain.headers.etag);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(estimates.unexpiredReads).toBe(0);
  });

  it("Estimate store unavailable: 200 with the stored stopTimes and no eta", async () => {
    // Arrange
    estimates.failWith = new Error("connection pool closed");

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", null]);
    expect(res.body.data.days[0].schedule[1]).not.toHaveProperty("eta");
  });

  it("leaves the cached schedule unmutated", async () => {
    // Arrange
    const schedule = etaApp.get(BusScheduleService);
    const before = JSON.stringify(await schedule.resolveSmartSchedule("campus-inja"));
    store(estimate("frozen"));

    // Act
    await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(JSON.stringify(await schedule.resolveSmartSchedule("campus-inja"))).toBe(before);
  });

  it("ignores an estimate whose offsets no longer fit the sequence", async () => {
    // Fetched while the sequence had three stops.
    // Arrange
    store(estimate("live", [0, 3060, 3180]));

    // Act
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");

    // Assert
    expect(res.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", null]);
  });
});

// WHY: a service id is a lookup key, so a name Object.prototype already has must miss like any other
// unknown id (spencer0124/skkuverse#82).
describe("GET /bus/schedule/data/:serviceId with an Object.prototype name", () => {
  const PROTOTYPE_NAMES = ["toString", "__proto__", "constructor", "hasOwnProperty"];

  it.each(PROTOTYPE_NAMES)("%s/week → 404 SERVICE_NOT_FOUND", async (serviceId) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/${serviceId}/week`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "SERVICE_NOT_FOUND", message: `Unknown serviceId: ${serviceId}` });
  });

  it.each(PROTOTYPE_NAMES)("%s/smart → 404 SERVICE_NOT_FOUND", async (serviceId) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/${serviceId}/smart`);

    // Assert
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "SERVICE_NOT_FOUND", message: `Unknown serviceId: ${serviceId}` });
  });
});

// WHY: each distinct Monday gets its own cached week and two Atlas reads, so `from` is bounded to a year
// either side of today (KST); the clock reads 2026-03-10.
describe("GET /bus/schedule/data/:serviceId/week with a far from", () => {
  it.each(["2025-03-10", "2027-03-10", "2026-03-09"])("from=%s → 200", async (from) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

    // Assert
    expect(res.status).toBe(200);
  });

  it.each(["2025-03-09", "2027-03-11", "1970-01-05", "9999-12-27", "2026-02-31"])("from=%s → 400 INVALID_DATE_FORMAT", async (from) => {
    // Act
    const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ code: "INVALID_DATE_FORMAT", message: "from must be a date within a year of today" });
  });

  it("answers 400 before looking the service up", async () => {
    // Act
    const res = await request(httpServer).get("/bus/schedule/data/unknown/week?from=2030-01-07");

    // Assert
    expect(res.status).toBe(400);
  });
});

// QUIRK(date-holidays): isHoliday never returns for an Invalid Date (an impossible day, or a year-10000 day
// of a 9999-12-27 week), so a `from` that reached the week build would block the event loop.
describe("GET /bus/schedule/data/:serviceId/week with a from that would hang the holiday lookup", () => {
  const HANG_BUDGET_MS = 2_000;

  // WHY: a hang is synchronous, so no jest timeout could end it; a stubbed week build turns a `from` that gets
  // past the check into a fast failure of the not-called assertion instead of a stuck run.
  beforeEach(() => {
    resolveWeek.mockResolvedValue(null);
  });

  it.each(["2026-02-31", "2026-13-01", "9999-01-04", "2026-02-29", "2026-04-31", "0000-01-03"])(
    "from=%s → 400 INVALID_DATE_FORMAT without building a week",
    async (from) => {
      // Act
      const res = await request(httpServer).get(`/bus/schedule/data/campus-inja/week?from=${from}`);

      // Assert
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({ code: "INVALID_DATE_FORMAT", message: "from must be a date within a year of today" });
      expect(resolveWeek).not.toHaveBeenCalled();
    },
    HANG_BUDGET_MS,
  );
});
