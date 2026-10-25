/**
 * MINIAPP_PUSH_QUOTA (ADR 0023, D7): a send is allowed, or refused with a whole number of seconds to wait that
 * the binding sends as `Retry-After`.
 */
import type { MiniAppPushQuota, PerimeterDeps } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterTestDeps } from "./perimeter-deps";

export function describeMiniAppPushQuotaContract(make: (deps: PerimeterDeps) => MiniAppPushQuota): void {
  describe("the MINIAPP_PUSH_QUOTA contract", () => {
    itConstructsLikeThePoller(make);

    it("answers a send as allowed, or refused with a positive whole Retry-After", async () => {
      // Act
      const decision = await make(perimeterTestDeps()).take("mukja");

      // Assert
      if (decision.allowed) expect(decision).toEqual({ allowed: true });
      else expect(Number.isInteger(decision.retryAfterSeconds) && decision.retryAfterSeconds > 0).toBe(true);
    });
  });
}
