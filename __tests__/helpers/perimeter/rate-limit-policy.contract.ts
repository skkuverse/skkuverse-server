/**
 * RATE_LIMIT_POLICY (ADR 0023, D7): one handler per class for the process, so every module that binds a class
 * shares its count, and a request over the limit answers 429 with the public body. The suite drives each class to
 * its refusal from one address without knowing the limit.
 */
import express from "express";
import request from "supertest";
import { RATE_LIMIT_CLASSES, RATE_LIMITED_BODY, type PerimeterDeps, type RateLimitPolicy } from "../../../src/perimeter/perimeter.ports";
import { LoopbackServers } from "../nest/loopback-servers";
import { itConstructsLikeThePoller, perimeterTestDeps } from "./perimeter-deps";

// WHY: a bound on the drive, not a limit any implementation is held to: a limiter that never refuses fails.
const MAX_REQUESTS_TO_REFUSAL = 1_000;

export function describeRateLimitPolicyContract(make: (deps: PerimeterDeps) => RateLimitPolicy): void {
  describe("the RATE_LIMIT_POLICY contract", () => {
    const servers = new LoopbackServers();

    afterEach(async () => {
      await servers.closeAll();
    });

    itConstructsLikeThePoller(make);

    it.each(RATE_LIMIT_CLASSES)("hands out one handler for %s on every call", (limitClass) => {
      // Arrange
      const policy = make(perimeterTestDeps());

      // Act
      const first = policy.handlerFor(limitClass);
      const second = policy.handlerFor(limitClass);

      // Assert
      expect(typeof first).toBe("function");
      expect(second).toBe(first);
    });

    it.each(RATE_LIMIT_CLASSES)("refuses %s from one address with 429 and the public body", async (limitClass) => {
      // Arrange
      const app = express();
      app.use(make(perimeterTestDeps()).handlerFor(limitClass));
      app.get("/limited", (_req, res) => {
        res.json({ ok: true });
      });
      const server = await servers.serve(app);
      let refusal: request.Response | undefined;

      // Act
      for (let sent = 0; sent < MAX_REQUESTS_TO_REFUSAL && refusal === undefined; sent++) {
        const res = await request(server).get("/limited");
        if (res.status !== 200) refusal = res;
      }

      // Assert
      expect(refusal?.status).toBe(429);
      expect(refusal?.body).toEqual(RATE_LIMITED_BODY);
    });
  });
}
