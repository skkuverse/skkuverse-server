/**
 * Integration over the real ScheduleController (@Res() ETag/304) with
 * ScheduleService overridden by the MOCK_WEEK/MOCK_SMART/MOCK_SUSPENDED/
 * MOCK_NODATA fixtures.
 *
 * Asserts the wire format: envelope shape, 200/404 status + error codes, ETag
 * format regexes ("week-…"/"smart-…"), 304 on If-None-Match, Cache-Control
 * max-age=300 (60 with arrival estimates), i18n message presence/absence per
 * status + en translations, and X-Response-Time present on 200 but ABSENT on
 * 304. The last block applies stored arrival estimates (spec
 * shuttle-arrival-eta) through a ShuttleEtaService stub.
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { ScheduleService } from "../../../src/bus/schedule/schedule.service";
import { ShuttleEtaService, runKey, type ServedEstimate } from "../../../src/bus/eta/shuttle-eta.service";
import { buildBusApp } from "../../helpers/nest/build-bus-app";

const MOCK_WEEK = {
  serviceId: "campus-inja",
  requestedFrom: "2026-03-09",
  from: "2026-03-09",
  days: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-03-${String(9 + i).padStart(2, "0")}`,
    dayOfWeek: i + 1,
    display: i < 4 ? "schedule" : "noService",
    label: null,
    notices: [],
    schedule: i < 4 ? [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] : [],
  })),
};

const MOCK_SMART = {
  serviceId: "campus-inja",
  status: "active",
  from: "2026-03-09",
  selectedDate: "2026-03-10",
  days: [
    { date: "2026-03-09", dayOfWeek: 1, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-10", dayOfWeek: 2, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-11", dayOfWeek: 3, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-12", dayOfWeek: 4, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
    { date: "2026-03-13", dayOfWeek: 5, display: "schedule", label: null, notices: [], schedule: [{ index: 1, time: "08:00", routeType: "regular", busCount: 1, notes: null }] },
  ],
};

const MOCK_SUSPENDED = {
  serviceId: "campus-inja",
  status: "suspended",
  resumeDate: "2026-09-01",
  from: null,
  selectedDate: null,
  days: [],
};

const MOCK_NODATA = {
  serviceId: "campus-inja",
  status: "noData",
  from: null,
  selectedDate: null,
  days: [],
};

let app: NestExpressApplication;
let resolveWeek: jest.Mock;
let resolveSmartSchedule: jest.Mock;
let httpServer: import("http").Server;

beforeAll(async () => {
  resolveWeek = jest.fn();
  resolveSmartSchedule = jest.fn();
  const scheduleStub = {
    resolveWeek,
    resolveSmartSchedule,
    clearCache: jest.fn(),
    clearCacheForService: jest.fn(),
    onModuleInit: jest.fn(),
  };
  app = await buildBusApp([{ provide: ScheduleService, useValue: scheduleStub }]);
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  resolveWeek.mockResolvedValue(MOCK_WEEK);
  resolveSmartSchedule.mockResolvedValue(MOCK_SMART);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("GET /bus/schedule/data/:serviceId/week", () => {
  it("returns 200 with correct shape", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
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
    resolveWeek.mockResolvedValue(null);
    const res = await request(httpServer).get("/bus/schedule/data/unknown/week");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  it("returns 400 INVALID_DATE_FORMAT for bad from param", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE_FORMAT");
  });

  it("returns 400 INVALID_DATE_FORMAT for repeated from (?from=A&from=B coercion)", async () => {
    const res = await request(httpServer).get(
      "/bus/schedule/data/campus-inja/week?from=2026-03-09&from=2026-03-10",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DATE_FORMAT");
  });

  it("response includes ETag header", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    expect(res.headers.etag).toBeDefined();
  });

  it("returns 304 when If-None-Match matches ETag (no body, no X-Response-Time)", async () => {
    const res1 = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    const etag = res1.headers.etag;

    const res2 = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/week?from=2026-03-09")
      .set("If-None-Match", etag);
    expect(res2.status).toBe(304);
    expect(res2.text).toBe("");
    expect(res2.headers["x-response-time"]).toBeUndefined();
  });

  it("sets Cache-Control header", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    expect(res.headers["cache-control"]).toContain("max-age=300");
  });

  it("ETag format is week-{serviceId}-{from}-{hash}", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week?from=2026-03-09");
    expect(res.headers.etag).toMatch(/^"week-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  it("works when from is omitted", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/week");
    expect(res.status).toBe(200);
    expect(resolveWeek).toHaveBeenCalledWith("campus-inja", undefined);
  });
});

describe("GET /bus/schedule/data/:serviceId/smart", () => {
  it("returns 200 with selectedDate and no hidden days", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
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
    resolveSmartSchedule.mockResolvedValue(null);
    const res = await request(httpServer).get("/bus/schedule/data/unknown/smart");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("SERVICE_NOT_FOUND");
  });

  it("response includes ETag header with smart- prefix", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    const res1 = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    const etag = res1.headers.etag;
    const res2 = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("If-None-Match", etag);
    expect(res2.status).toBe(304);
  });

  it("sets Cache-Control header: 60 s for a service with arrival estimates, 300 s otherwise", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    resolveSmartSchedule.mockResolvedValue({ ...MOCK_SMART, serviceId: "commute-jeongja" });
    const commute = await request(httpServer).get("/bus/schedule/data/commute-jeongja/smart");
    expect(commute.headers["cache-control"]).toBe("public, max-age=300");
  });

  it("ETag format is smart-{serviceId}-{from}-{hash} for active", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-2026-03-09-[a-f0-9]{32}"$/);
  });

  it("suspended response includes i18n message and resumeDate", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_SUSPENDED);
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("suspended");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.resumeDate).toBe("2026-09-01");
    expect(res.body.data.days).toHaveLength(0);
  });

  it("noData response includes i18n message", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_NODATA);
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("noData");
    expect(res.body.data.message).toBeDefined();
    expect(typeof res.body.data.message).toBe("string");
    expect(res.body.data.days).toHaveLength(0);
  });

  it("active response does not include message", async () => {
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    expect(res.body.data.message).toBeUndefined();
  });

  it("ETag uses status when from is null (suspended)", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_SUSPENDED);
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-suspended-[a-f0-9]{32}"$/);
  });

  it("ETag uses status when from is null (noData)", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_NODATA);
    const res = await request(httpServer).get("/bus/schedule/data/campus-inja/smart");
    expect(res.headers.etag).toMatch(/^"smart-campus-inja-noData-[a-f0-9]{32}"$/);
  });

  it("suspended with Accept-Language: en returns English message", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_SUSPENDED);
    const res = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");
    expect(res.body.data.message).toBe("Service is suspended");
  });

  it("noData with Accept-Language: en returns English message", async () => {
    resolveSmartSchedule.mockResolvedValue(MOCK_NODATA);
    const res = await request(httpServer)
      .get("/bus/schedule/data/campus-inja/smart")
      .set("Accept-Language", "en");
    expect(res.body.data.message).toBe("Schedule information is being prepared");
  });
});

describe("GET …/smart with arrival estimates", () => {
  let etaApp: NestExpressApplication;
  let server: import("http").Server;
  const smart = jest.fn();
  const estimates = jest.fn();
  const FETCHED = new Date("2026-10-12T00:20:00.000Z");

  // A Monday of the 인자셔틀: one regular run at 10:00, stored with null drop-offs.
  const inja = () => ({
    serviceId: "campus-inja",
    status: "active",
    from: "2026-10-12",
    selectedDate: "2026-10-12",
    days: [
      {
        date: "2026-10-12",
        dayOfWeek: 1,
        display: "schedule",
        label: null,
        notices: [],
        schedule: [
          { index: 1, time: "07:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["07:00", null] },
          { index: 2, time: "10:00", routeType: "regular", busCount: 1, notes: null, stopTimes: ["10:00", null] },
        ],
      },
    ],
  });
  const estimate = (source: ServedEstimate["source"], offsetsSec = [0, 3060]): Map<string, ServedEstimate> =>
    new Map([[runKey("campus-inja", "regular", "2026-10-12", "10:00"), { offsetsSec, source, updatedAt: FETCHED }]]);

  beforeAll(async () => {
    etaApp = await buildBusApp([
      { provide: ScheduleService, useValue: { resolveWeek: jest.fn(), resolveSmartSchedule: smart, onModuleInit: jest.fn() } },
      { provide: ShuttleEtaService, useValue: { estimates } },
    ]);
    server = etaApp.getHttpServer();
  });
  afterAll(async () => {
    await etaApp.close();
  });
  beforeEach(() => {
    smart.mockReset();
    estimates.mockReset();
  });

  it.each(["live", "frozen", "predicted"] as const)("Live entry: fills the drop-offs and names the source (%s)", async (source) => {
    smart.mockResolvedValue(inja());
    estimates.mockResolvedValue(estimate(source));
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");
    const [early, run] = res.body.data.days[0].schedule;
    expect(run.stopTimes).toEqual(["10:00", "10:51"]);
    expect(run.eta).toEqual({ source, updatedAt: "2026-10-12T00:20:00.000Z" });
    expect(early.stopTimes).toEqual(["07:00", null]);
    expect(early).not.toHaveProperty("eta");
  });

  it("New live value: the ETag changes with the estimate, and the header is max-age=60", async () => {
    smart.mockResolvedValue(inja());
    estimates.mockResolvedValue(estimate("live"));
    const first = await request(server).get("/bus/schedule/data/campus-inja/smart");
    smart.mockResolvedValue(inja());
    estimates.mockResolvedValue(estimate("live", [0, 3360]));
    const second = await request(server).get("/bus/schedule/data/campus-inja/smart");
    expect(second.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", "10:56"]);
    expect(second.headers.etag).not.toBe(first.headers.etag);
    expect(second.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("Commute runs carry no estimate: the body and headers are what they were without estimates", async () => {
    const commute = () => ({ ...inja(), serviceId: "commute-jeongja" });
    smart.mockResolvedValue(commute());
    estimates.mockResolvedValue(new Map());
    const plain = await request(server).get("/bus/schedule/data/commute-jeongja/smart");
    smart.mockResolvedValue(commute());
    estimates.mockResolvedValue(new Map([[runKey("commute-jeongja", "regular", "2026-10-12", "10:00"), estimate("live").values().next().value!]]));
    const res = await request(server).get("/bus/schedule/data/commute-jeongja/smart");
    expect(JSON.stringify(res.body.data)).toBe(JSON.stringify(plain.body.data));
    expect(res.headers.etag).toBe(plain.headers.etag);
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(estimates).not.toHaveBeenCalled();
  });

  it("Estimate store unavailable: 200 with the stored stopTimes and no eta", async () => {
    smart.mockResolvedValue(inja());
    estimates.mockRejectedValue(new Error("connection pool closed"));
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");
    expect(res.status).toBe(200);
    expect(res.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", null]);
    expect(res.body.data.days[0].schedule[1]).not.toHaveProperty("eta");
  });

  it("leaves the cached schedule unmutated", async () => {
    const cached = inja();
    const before = JSON.stringify(cached);
    smart.mockResolvedValue(cached);
    estimates.mockResolvedValue(estimate("frozen"));
    await request(server).get("/bus/schedule/data/campus-inja/smart");
    expect(JSON.stringify(cached)).toBe(before);
  });

  it("ignores an estimate whose offsets no longer fit the sequence", async () => {
    smart.mockResolvedValue(inja());
    // Fetched while the sequence had three stops.
    estimates.mockResolvedValue(estimate("live", [0, 3060, 3180]));
    const res = await request(server).get("/bus/schedule/data/campus-inja/smart");
    expect(res.body.data.days[0].schedule[1].stopTimes).toEqual(["10:00", null]);
  });
});
