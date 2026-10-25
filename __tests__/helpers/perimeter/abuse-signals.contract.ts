/**
 * ABUSE_SIGNALS (ADR 0023, D7): reporting a signal never throws into the request that raised it.
 */
import type { AbuseSignals, PerimeterDeps } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

export function describeAbuseSignalsContract(make: (deps: PerimeterDeps) => AbuseSignals): void {
  describe("the ABUSE_SIGNALS contract", () => {
    itConstructsLikeThePoller(make);

    it.each(["auth.rejected", "internal.rejected", "push.refused", "rate.limited"] as const)("takes a %s signal without throwing", (kind) => {
      // Act & Assert
      expect(() => make(perimeterTestDeps()).report({ kind, request: perimeterRequest(), principal: { kind: "anonymous" } })).not.toThrow();
    });
  });
}
