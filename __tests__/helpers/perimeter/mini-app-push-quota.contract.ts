/**
 * MINIAPP_PUSH_QUOTA (ADR 0023, D7): every decision over a burst of sends from one sender, counted through the
 * shared counters, has the shape the binding reads: allowed, or refused with a positive whole number of seconds it
 * sends as `Retry-After`. When a sender is refused is policy, tested beside the implementation that refuses.
 */
import type { MiniAppPushQuota, PerimeterDeps, QuotaDecision } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterTestDeps } from "./perimeter-deps";

// WHY: a bound on the burst, not a quota any implementation is held to.
const BURST_SENDS = 1_000;

function isWellFormed(decision: QuotaDecision): boolean {
  if (decision.allowed) return Object.keys(decision).length === 1;
  return Number.isInteger(decision.retryAfterSeconds) && decision.retryAfterSeconds > 0;
}

export function describeMiniAppPushQuotaContract(make: (deps: PerimeterDeps) => MiniAppPushQuota): void {
  describe("the MINIAPP_PUSH_QUOTA contract", () => {
    itConstructsLikeThePoller(make);

    it("answers every send of a burst as allowed, or refused with a positive whole Retry-After", async () => {
      // Arrange
      const quota = make(perimeterTestDeps());
      const decisions: QuotaDecision[] = [];

      // Act
      for (let sent = 0; sent < BURST_SENDS; sent++) decisions.push(await quota.take("mukja"));

      // Assert
      expect(decisions.filter((decision) => !isWellFormed(decision))).toEqual([]);
    });
  });
}
