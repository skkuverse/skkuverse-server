/**
 * GET /notices/overview through the assembled notices modules: envelope, 400s,
 * route ordering against the detail route, and the overview-only rate limit.
 *
 * The retrieval repository and the ai client are typed fakes, and the list and
 * detail repositories too; everything between them (auth and limiter middleware,
 * controller, service, mapping, the response interceptor) is real.
 * With NOTICE_OVERVIEW=off, as production runs, the route answers the "no
 * overview" body the app hides the card on, and reaches neither Atlas nor the ai.
 * Every request carries its own X-Forwarded-For so the overview limiter
 * only trips in the test that means to trip it.
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { Clock } from "../../../../src/infra/clock";
import config from "../../../../src/infra/config";
import { NoticesDetailModule } from "../../../../src/notices/detail/notices-detail.module";
import { NoticesDetailRepository } from "../../../../src/notices/detail/notices-detail.repository";
import { NoticesListModule } from "../../../../src/notices/list/notices-list.module";
import { NoticesListRepository } from "../../../../src/notices/list/notices-list.repository";
import { NoticesModule } from "../../../../src/notices/notices.module";
import { NoticesOverviewClient } from "../../../../src/notices/overview/notices-overview.client";
import { NoticesOverviewModule } from "../../../../src/notices/overview/notices-overview.module";
import { NoticesOverviewRepository } from "../../../../src/notices/overview/notices-overview.repository";
import { overviewData, overviewMeta } from "../../../../src/notices/overview/notices-overview.wire";
import { RateLimitPolicy, RequestAuthenticator } from "../../../../src/perimeter/perimeter.ports";
import { FakeRequestAuthenticator } from "../../../helpers/fakes/perimeter/request-authenticator.fake";
import { expectWire } from "../../../helpers/contracts/expect-wire";
import { FakeNoticesDetailRepository } from "../../../helpers/fakes/notices/notices-detail.repository.fake";
import { FakeNoticesListRepository } from "../../../helpers/fakes/notices/notices-list.repository.fake";
import { FakeNoticesOverviewClient } from "../../../helpers/fakes/notices/notices-overview.client.fake";
import { FakeNoticesOverviewRepository } from "../../../helpers/fakes/notices/notices-overview.repository.fake";
import { buildTestApp } from "../../../helpers/nest/build-test-app";
import { aiResponse, candidate } from "../../../helpers/overview-fixtures";
import { FakeRateLimitPolicy } from "../../../helpers/fakes/perimeter/rate-limit-policy.fake";

let app: NestExpressApplication;
let http: import("http").Server;
const overviewRepository = new FakeNoticesOverviewRepository();
const overviewClient = new FakeNoticesOverviewClient();
const detailRepository = new FakeNoticesDetailRepository();
const rateLimitPolicy = new FakeRateLimitPolicy();
const fakeClock: Clock = { now: () => new Date("2026-10-06T08:00:00.000Z") };
let searchCandidates: jest.SpyInstance;
let findNotice: jest.SpyInstance;

let ipSeq = 0;
function get(path: string, ip = `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`) {
  return request(http).get(path).set("X-Forwarded-For", ip);
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [NoticesModule, NoticesListModule, NoticesOverviewModule, NoticesDetailModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: rateLimitPolicy },
      { provide: RequestAuthenticator, useValue: new FakeRequestAuthenticator() },
      { provide: NoticesListRepository, useValue: new FakeNoticesListRepository() },
      { provide: NoticesOverviewRepository, useValue: overviewRepository },
      { provide: NoticesOverviewClient, useValue: overviewClient },
      { provide: NoticesDetailRepository, useValue: detailRepository },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.restoreAllMocks();
  overviewRepository.candidates = [];
  overviewClient.outcome = { kind: "failed", httpStatus: null, code: "unscripted" };
  overviewClient.requests = [];
  searchCandidates = jest.spyOn(overviewRepository, "searchCandidates");
  findNotice = jest.spyOn(detailRepository, "findNotice");
});

describe("GET /notices/overview", () => {
  it("returns the overview envelope", async () => {
    // Arrange
    const doc = candidate({ sourceId: "skku-main", articleNo: "140112", title: "ROTC 모집", date: "2026-09-24" });
    overviewRepository.candidates = [doc];
    overviewClient.outcome = {
      kind: "ok",
      response: aiResponse({
        lead: { text: "ROTC 지원은 10월 13일까지예요.", cites: [1] },
        points: [{ text: "대상은 1·2학년이에요.", cites: [1] }],
        sources: [{ n: 1, contentMissing: false }],
      }),
    };

    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=ROTC%20%EC%96%B8%EC%A0%9C%EA%B9%8C%EC%A7%80");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ lang: "ko", cached: false });
    expect(res.body.data.overview).toEqual({
      lead: { text: "ROTC 지원은 10월 13일까지예요.", cites: [1] },
      points: [{ text: "대상은 1·2학년이에요.", cites: [1] }],
      sources: [
        { n: 1, sourceId: "skku-main", articleNo: "140112", title: "ROTC 모집", date: "2026-09-24", contentMissing: false },
      ],
      lang: "ko",
      generatedAt: expect.any(String),
    });
  });

  it("returns a null overview with a reason, still 200", async () => {
    // Arrange
    overviewRepository.candidates = [];

    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=zzz");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      meta: { lang: "ko", cached: false, reason: "no_results" },
      data: { overview: null },
    });
  });

  it("passes the client language to the ai", async () => {
    // Arrange
    overviewRepository.candidates = [candidate()];
    overviewClient.outcome = { kind: "ok", response: aiResponse({ lang: "en" }) };

    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=scholarship").set("Accept-Language", "en");

    // Assert
    expect(overviewClient.requests[0]!.lang).toBe("en");
    expect(res.body.data.overview.lang).toBe("en");
  });

  it.each([
    ["missing q", "/notices/overview?sourceIds=skku-main", "INVALID_PARAMS"],
    ["21 sources", `/notices/overview?q=x&sourceIds=${Array(21).fill("skku-main").join(",")}`, "INVALID_PARAMS"],
    ["unknown source", "/notices/overview?q=x&sourceIds=nope", "INVALID_SOURCE_ID"],
    ["repeated sourceIds", "/notices/overview?q=x&sourceIds=skku-main&sourceIds=skku-main", "INVALID_PARAMS"],
    ["blank q", "/notices/overview?sourceIds=skku-main&q=%20%20", "INVALID_PARAMS"],
  ])("returns 400 for %s", async (_label, path, code) => {
    // Act
    const res = await get(path);

    // Assert
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(searchCandidates).not.toHaveBeenCalled();
  });

  it("is not routed to the notice detail handler", async () => {
    // Arrange
    overviewRepository.candidates = [];

    // Act
    await get("/notices/overview?sourceIds=skku-main&q=x");

    // Assert
    expect(findNotice).not.toHaveBeenCalled();
    expect(searchCandidates).toHaveBeenCalledTimes(1);
  });
});

describe("GET /notices/overview bodies", () => {
  const bodyOf = (res: { body: { data: unknown; meta: Record<string, unknown> } }) => {
    const { lang, ...meta } = res.body.meta;
    return { lang, data: res.body.data, meta };
  };

  it("an answer, its cached repeat and a no_answer parse with the published overviewData and overviewMeta wires", async () => {
    // Arrange
    overviewRepository.candidates = [candidate(), candidate()];
    overviewClient.outcome = { kind: "ok", response: aiResponse({ sources: [{ n: 1, contentMissing: false }, { n: 2, contentMissing: true }] }) };
    const answered = await get("/notices/overview?sourceIds=skku-main&q=wire-answer");

    // Act
    const repeat = await get("/notices/overview?sourceIds=skku-main&q=wire-answer");
    overviewClient.outcome = { kind: "ok", response: aiResponse({ status: "no_answer", lead: null, points: [], sources: [] }) };
    const noAnswer = await get("/notices/overview?sourceIds=skku-main&q=wire-no-answer");

    // Assert
    expect([answered.status, repeat.status, noAnswer.status]).toEqual([200, 200, 200]);
    expect([answered.body.meta.cached, repeat.body.meta.cached, noAnswer.body.meta.reason]).toEqual([false, true, "no_answer"]);
    for (const res of [answered, repeat, noAnswer]) {
      const { lang, data, meta } = bodyOf(res);
      expect(lang).toBe("ko");
      expectWire(overviewData, data);
      expectWire(overviewMeta, meta);
    }
  });

  it("no_results and unavailable parse with the published overviewData and overviewMeta wires", async () => {
    // Arrange
    const noResults = await get("/notices/overview?sourceIds=skku-main&q=wire-none");
    overviewRepository.candidates = [candidate()];
    overviewClient.outcome = { kind: "failed", httpStatus: 503, code: "upstream" };

    // Act
    const unavailable = await get("/notices/overview?sourceIds=skku-main&q=wire-down");

    // Assert
    expect([noResults.body.meta.reason, unavailable.body.meta.reason]).toEqual(["no_results", "unavailable"]);
    for (const res of [noResults, unavailable]) {
      const { lang, data, meta } = bodyOf(res);
      expect(lang).toBe("ko");
      expectWire(overviewData, data);
      expectWire(overviewMeta, meta);
    }
  });
});

describe("overview rate limit", () => {
  // WHY: the limit itself is RATE_LIMIT_POLICY's, tested beside each implementation (ADR 0023, D7); the
  // route keeps what the binding decides: each request spends the notices class and the overview's own, once.
  it("spends the notices class and the overview class once per request", async () => {
    // Arrange
    overviewRepository.candidates = [candidate()];
    overviewClient.outcome = { kind: "ok", response: aiResponse() };
    const before = new Map(rateLimitPolicy.counts);

    // Act
    const res = await get("/notices/overview?sourceIds=skku-main&q=counted");

    // Assert
    expect(res.status).toBe(200);
    expect(rateLimitPolicy.counts.get("notices")! - before.get("notices")!).toBe(1);
    expect(rateLimitPolicy.counts.get("notices-overview")! - before.get("notices-overview")!).toBe(1);
    expect(rateLimitPolicy.counts.get("general")).toBe(0);
  });

  it("answers 429 and makes no ai call when the overview class refuses", async () => {
    // Arrange
    overviewRepository.candidates = [candidate()];
    overviewClient.outcome = { kind: "ok", response: aiResponse() };
    const callsBefore = overviewClient.requests.length;
    rateLimitPolicy.refused.add("notices-overview");

    try {
      // Act
      const limited = await get("/notices/overview?sourceIds=skku-main&q=one-more", "198.51.100.7");

      // Assert
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe("RATE_LIMIT");
      expect(overviewClient.requests.length).toBe(callsBefore);
    } finally {
      rateLimitPolicy.refused.clear();
    }
  });

  it("leaves the list endpoint on its own, larger limit", async () => {
    // Act
    const res = await get("/notices?sourceIds=skku-main", "198.51.100.7");

    // Assert
    expect(res.status).toBe(200);
  });
});

describe("GET /notices/overview with NOTICE_OVERVIEW=off", () => {
  const overviewConfig = config.notices.overview as { enabled: boolean };

  it("answers 200 with a null overview, reason unavailable, no-store, and no retrieval or ai call", async () => {
    // Arrange
    overviewRepository.candidates = [candidate()];
    overviewClient.outcome = { kind: "ok", response: aiResponse() };
    const enabled = overviewConfig.enabled;
    overviewConfig.enabled = false;

    try {
      // Act
      const res = await get("/notices/overview?sourceIds=skku-main&q=%EC%9E%A5%ED%95%99%EA%B8%88");

      // Assert
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toEqual({ meta: { lang: "ko", cached: false, reason: "unavailable" }, data: { overview: null } });
      const { lang, ...meta } = res.body.meta;
      expect(lang).toBe("ko");
      expectWire(overviewData, res.body.data);
      expectWire(overviewMeta, meta);
      expect(searchCandidates).not.toHaveBeenCalled();
      expect(overviewClient.requests).toEqual([]);
    } finally {
      overviewConfig.enabled = enabled;
    }
  });
});
