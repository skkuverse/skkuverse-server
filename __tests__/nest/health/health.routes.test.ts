/**
 * GET /health and /health/ready answer raw JSON, not the { meta, data }
 * envelope: liveness is always 200; readiness is 200 only when the database
 * pings and, outside ROLE=api, the pollers have started, and 503 with the
 * reason otherwise. A database outage logs `health.db_unreachable` once per
 * minute, however often it is probed.
 */
import { Global, Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { HealthModule } from "../../../src/health/health.module";
import { ping } from "../../../src/infra/db";
import logger from "../../../src/infra/logger";
import { PollerRegistryService } from "../../../src/scheduling/poller-registry.service";
import { buildTestApp } from "../../helpers/nest/build-test-app";

jest.mock("../../../src/infra/db", () => ({ ping: jest.fn() }));

const mockPing = ping as jest.MockedFunction<typeof ping>;
const pollers = { isReady: jest.fn<boolean, []>() };

// Stands in for the @Global SchedulingModule, which provides the registry in main.ts.
@Global()
@Module({
  providers: [{ provide: PollerRegistryService, useValue: pollers }],
  exports: [PollerRegistryService],
})
class SchedulingStubModule {}

let app: NestExpressApplication;
let httpServer: import("http").Server;
const originalRole = process.env.ROLE;

beforeAll(async () => {
  app = await buildTestApp({ imports: [SchedulingStubModule, HealthModule] });
  httpServer = app.getHttpServer();
});

beforeEach(() => {
  mockPing.mockReset().mockResolvedValue(undefined);
  pollers.isReady.mockReset().mockReturnValue(true);
  delete process.env.ROLE;
});

afterAll(async () => {
  if (originalRole === undefined) delete process.env.ROLE;
  else process.env.ROLE = originalRole;
  await app.close();
});

describe("GET /health", () => {
  it("is always 200 with the raw status and uptime", async () => {
    // Act
    const res = await request(httpServer).get("/health");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", uptime: expect.any(Number) });
  });
});

describe("GET /health/ready", () => {
  it("is 200 when the database pings and the pollers have started", async () => {
    // Act
    const res = await request(httpServer).get("/health/ready");

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", uptime: expect.any(Number) });
  });

  it("is 503 while the pollers have not started, outside ROLE=api", async () => {
    // Arrange
    pollers.isReady.mockReturnValue(false);

    // Act
    const res = await request(httpServer).get("/health/ready");

    // Assert
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: "unavailable", reason: "pollers not started" });
  });

  it("does not wait for pollers on ROLE=api, which starts none", async () => {
    // Arrange
    process.env.ROLE = "api";
    pollers.isReady.mockReturnValue(false);

    // Act
    const res = await request(httpServer).get("/health/ready");

    // Assert
    expect(res.status).toBe(200);
    expect(pollers.isReady).not.toHaveBeenCalled();
  });

  it("is 503 when the database does not ping, and logs that once per minute", async () => {
    // Arrange
    mockPing.mockRejectedValue(new Error("connection refused"));
    const error = jest.spyOn(logger, "error").mockImplementation(() => logger);

    // Act
    const first = await request(httpServer).get("/health/ready");
    const second = await request(httpServer).get("/health/ready");

    // Assert
    expect(first.status).toBe(503);
    expect(first.body).toEqual({ status: "unavailable", reason: "db unreachable" });
    expect(second.status).toBe(503);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toMatchObject({ event: "health.db_unreachable", suppressed: 0 });
    error.mockRestore();
  });
});
