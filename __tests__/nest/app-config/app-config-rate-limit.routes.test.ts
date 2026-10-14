/**
 * The binding of the general rate-limit class on /app. AppConfigModule binds GeneralRateLimitMiddleware, which asks
 * RATE_LIMIT_POLICY for the general class's handler, on /app, as the bus, map, ui, building and miniapps modules do on
 * theirs. What it guards: GET /app/config spends the general class once per request, no other class; and when the
 * class refuses, the client gets its 429 RATE_LIMIT before the controller answers. The limit itself, how it counts
 * and its headers are the policy's, tested beside each implementation (ADR 0023, D7).
 */
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { AppConfigModule } from "../../../src/app-config/app-config.module";
import { AppConfigRepository } from "../../../src/app-config/app-config.repository";
import { ConfigModule } from "../../../src/config/config.module";
import { Clock } from "../../../src/infra/clock";
import { RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { storedPlatformGatesRepository } from "../../helpers/app-config/app-platform-gates";
import { FakeRateLimitPolicy } from "../../helpers/fakes/perimeter/rate-limit-policy.fake";
import { buildTestApp } from "../../helpers/nest/build-test-app";

const CLOCK: Clock = { now: () => new Date("2026-10-25T03:00:00.000Z") };

let app: NestExpressApplication;
let rateLimitPolicy: FakeRateLimitPolicy;

beforeEach(async () => {
  rateLimitPolicy = new FakeRateLimitPolicy();
  app = await buildTestApp({
    imports: [ConfigModule, AppConfigModule],
    overrides: [
      { provide: RateLimitPolicy, useValue: rateLimitPolicy },
      { provide: AppConfigRepository, useValue: storedPlatformGatesRepository() },
      { provide: Clock, useValue: CLOCK },
    ],
  });
});

afterEach(async () => {
  await app.close();
});

describe("GET /app/config rate limit", () => {
  it("spends the general class once per request, and no other class", async () => {
    // Act
    const statuses = [(await request(app.getHttpServer()).get("/app/config")).status, (await request(app.getHttpServer()).get("/app/config")).status];

    // Assert
    expect(statuses).toEqual([200, 200]);
    expect(Object.fromEntries(rateLimitPolicy.counts)).toEqual({ general: 2, notices: 0, "notices-overview": 0 });
  });

  it("answers 429 RATE_LIMIT when the general class refuses", async () => {
    // Arrange
    rateLimitPolicy.refused.add("general");

    // Act
    const res = await request(app.getHttpServer()).get("/app/config");

    // Assert
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: { code: "RATE_LIMIT", message: "Too many requests" } });
  });
});
