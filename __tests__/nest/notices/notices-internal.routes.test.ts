/**
 * (A perimeter detail is left out of the public history.)
 *
 *
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import { ObjectId } from "mongodb";
import request from "supertest";
import config from "../../../src/infra/config";
import { Clock } from "../../../src/infra/clock";
import { NoticesDispatchClient } from "../../../src/notices/dispatch/notices-dispatch.client";
import { NoticesDispatchModule } from "../../../src/notices/dispatch/notices-dispatch.module";
import { NoticesDispatchRepository } from "../../../src/notices/dispatch/notices-dispatch.repository";
import { NoticesDispatchService } from "../../../src/notices/dispatch/notices-dispatch.service";
import type { NoticeDoc } from "../../../src/notices/notices.document";
import { NoticesModule } from "../../../src/notices/notices.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { FakeNoticesDispatchClient } from "../../helpers/fakes/notices/notices-dispatch.client.fake";
import { FakeNoticesDispatchRepository } from "../../helpers/fakes/notices/notices-dispatch.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
let sweepPending: jest.SpyInstance;
const repository = new FakeNoticesDispatchRepository();
const client = new FakeNoticesDispatchClient();
// WHY: 01:30 KST on 2026-10-20, so the 14-day age gate's floor is the KST day 2026-10-06.
const fakeClock: Clock = { now: () => new Date("2026-10-19T16:30:00Z") };

function summarized(overrides: Partial<NoticeDoc> = {}): NoticeDoc {
  return {
    _id: new ObjectId(),
    sourceId: "skku-notice02",
    articleNo: 136023,
    title: "2026학년도 2학기 수강신청 안내",
    date: "2026-10-19",
    crawledAt: new Date("2026-10-19T15:00:00Z"),
    sourceUrl: "https://www.skku.edu/x",
    contentHash: "hash-1",
    aiSummaryAt: new Date("2026-10-19T15:05:00Z"),
    ...overrides,
  };
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, NoticesModule, NoticesDispatchModule],
    overrides: [
      { provide: NoticesDispatchRepository, useValue: repository },
      { provide: NoticesDispatchClient, useValue: client },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
  sweepPending = jest.spyOn(app.get(NoticesDispatchService), "sweepPending");
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  repository.notices = [];
  repository.records = [];
  client.pushes = [];
  client.error = null;
});

describe("POST /internal/notices/dispatch-pending", () => {
  it("rejects requests with a missing token", async () => {
    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .send({ source: "test" });

    // Assert
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(sweepPending).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong token (constant-time)", async () => {
    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", "wrong-token")
      .send({});

    // Assert
    expect(res.status).toBe(401);
    expect(sweepPending).not.toHaveBeenCalled();
  });

  it("sweeps the claimable notices and answers with the sweep's summary", async () => {
    // Arrange
    const notice = summarized();
    repository.notices = [notice];

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main", cycleId: "abc" });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", source: "crawler-main", processed: 1, sent: 1, failed: 0, cfCalls: 1 });
    expect(client.pushes.map((push) => push.notice._id.toHexString())).toEqual([notice._id.toHexString()]);
    expect(repository.notices[0]).toMatchObject({ pushedAt: new Date("2026-10-19T16:30:00Z"), dispatchClaimedAt: null, pushAttempts: 1 });
    expect(sweepPending).toHaveBeenCalledWith("crawler-main");
  });

  it("leaves a notice outside the claim window alone: older than the KST floor, pushed, or exhausted", async () => {
    // Arrange
    repository.notices = [
      summarized({ date: "2026-10-05" }),
      summarized({ pushedAt: new Date("2026-10-19T16:00:00Z") }),
      summarized({ pushAttempts: 5 }),
      summarized({ dispatchClaimedAt: new Date("2026-10-19T16:29:00Z") }),
      summarized({ date: "2026-10-06" }),
    ];

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 1 });
    expect(client.pushes.map((push) => push.notice.date)).toEqual(["2026-10-06"]);
  });

  it("answers a failed push as failed and releases its lease", async () => {
    // Arrange
    repository.notices = [summarized()];
    client.error = new Error("sendNotification 500");

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main" });

    // Assert
    expect(res.body.data).toMatchObject({ processed: 1, sent: 0, failed: 1, cfCalls: 1 });
    expect(repository.notices[0]).toMatchObject({ dispatchClaimedAt: null, pushError: "sendNotification 500", pushAttempts: 1 });
    expect(repository.notices[0]?.pushedAt).toBeUndefined();
  });

  it("records a notice whose board has no push topic as skipped, without a push or an attempt, and never claims it again", async () => {
    // Arrange
    repository.notices = [summarized({ sourceId: "skku-main" })];
    const ping = () =>
      request(httpServer).post("/internal/notices/dispatch-pending").set("X-Internal-Token", config.notices.dispatch.internalToken as string).send({});

    // Act
    const first = await ping();
    const second = await ping();

    // Assert
    expect(first.body.data).toMatchObject({ processed: 1, sent: 0, skippedNoTopics: 1, cfCalls: 0 });
    expect(second.body.data).toMatchObject({ processed: 0 });
    expect(client.pushes).toEqual([]);
    expect(repository.notices[0]).toMatchObject({ pushedAt: new Date("2026-10-19T16:30:00Z"), pushSkippedReason: "no-topic", dispatchClaimedAt: null });
    expect(repository.notices[0]?.pushAttempts).toBeUndefined();
  });

  it("defaults triggerSource to 'internal' when body.source is absent", async () => {
    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", source: "internal", processed: 0 });
    expect(sweepPending).toHaveBeenCalledWith("internal");
  });

  it("is NOT rate-limited and requires NO Firebase auth (no Bearer needed)", async () => {
    // Act
    // No Authorization header, no rate-limit middleware — a valid token alone
    // succeeds, confirming the internal route is bare.
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-x" });

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers["ratelimit-limit"]).toBeUndefined();
  });
});
