/**
 * ORIGIN_TRUST (ADR 0023, D5 and D7): a synchronous boolean per origin, which never trusts the opaque `null`
 * origin of a sandboxed page or a file, or an origin no deployment of this API serves.
 */
import type { OriginTrust, PerimeterDeps } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterTestDeps } from "./perimeter-deps";

export function describeOriginTrustContract(make: (deps: PerimeterDeps) => OriginTrust): void {
  describe("the ORIGIN_TRUST contract", () => {
    itConstructsLikeThePoller(make);

    it.each(["null", "https://attacker.example", "http://192.0.2.10:5173", ""])("does not trust %j", (origin) => {
      // Act & Assert
      expect(make(perimeterTestDeps()).isCorsOrigin(origin)).toBe(false);
    });
  });
}
