/**
 * (A perimeter detail is left out of the public history.)
 *
 *
 */

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import config from "../../../src/infra/config";
import { Clock } from "../../../src/infra/clock";
import { NoticesDispatchModule } from "../../../src/notices/dispatch/notices-dispatch.module";
import { NoticesDispatchRepository } from "../../../src/notices/dispatch/notices-dispatch.repository";
import { NoticesDispatchService } from "../../../src/notices/dispatch/notices-dispatch.service";
import { NoticesModule } from "../../../src/notices/notices.module";
import { SchedulingModule } from "../../../src/scheduling/scheduling.module";
import { FakeNoticesDispatchRepository } from "../../helpers/fakes/notices/notices-dispatch.repository.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

let app: NestExpressApplication;
let httpServer: import("http").Server;
// The route hands the trigger to NoticesDispatchService.sweepPending, spied on here as `dispatcher`.
let dispatcher: { sweepPending: jest.SpyInstance };
const fakeClock: Clock = { now: () => new Date("2026-10-19T16:30:00Z") };

function okSummary(source: string) {
  return {
    status: "ok" as const,
    source,
    processed: 0,
    sent: 0,
    failed: 0,
    skippedNoTopics: 0,
    durationMs: 1,
  };
}

beforeAll(async () => {
  app = await buildTestApp({
    imports: [SchedulingModule, NoticesModule, NoticesDispatchModule],
    overrides: [
      { provide: NoticesDispatchRepository, useValue: new FakeNoticesDispatchRepository() },
      { provide: Clock, useValue: fakeClock },
    ],
    role: "api",
  });
  dispatcher = { sweepPending: jest.spyOn(app.get(NoticesDispatchService), "sweepPending") };
  httpServer = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(dispatcher.sweepPending).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong token (constant-time)", async () => {
    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", "wrong-token")
      .send({});

    // Assert
    expect(res.status).toBe(401);
    expect(dispatcher.sweepPending).not.toHaveBeenCalled();
  });

  it("returns the sweep summary on the happy path", async () => {
    // Arrange
    dispatcher.sweepPending.mockResolvedValue(okSummary("crawler-main"));

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({ source: "crawler-main", cycleId: "abc" });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.source).toBe("crawler-main");
    expect(res.body.data.processed).toBe(0);
    expect(dispatcher.sweepPending).toHaveBeenCalledWith("crawler-main");
  });

  it("defaults triggerSource to 'internal' when body.source is absent", async () => {
    // Arrange
    dispatcher.sweepPending.mockResolvedValue(okSummary("internal"));

    // Act
    const res = await request(httpServer)
      .post("/internal/notices/dispatch-pending")
      .set("X-Internal-Token", config.notices.dispatch.internalToken as string)
      .send({});

    // Assert
    expect(res.status).toBe(200);
    expect(dispatcher.sweepPending).toHaveBeenCalledWith("internal");
  });

  it("is NOT rate-limited and requires NO Firebase auth (no Bearer needed)", async () => {
    // Arrange
    dispatcher.sweepPending.mockResolvedValue(okSummary("internal"));

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
