/**
 * OUTBOUND_POLICY (ADR 0023, D7): a URL that is no http or https URL, or whose host is a loopback, private or
 * link-local address, is never fetched, a request config is a fresh object a caller may spread, and an ordinary
 * failure is not reported as a refusal.
 */
import { OUTBOUND_PURPOSES, type OutboundPolicy, type PerimeterDeps } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterTestDeps } from "./perimeter-deps";

export function describeOutboundPolicyContract(make: (deps: PerimeterDeps) => OutboundPolicy): void {
  describe("the OUTBOUND_POLICY contract", () => {
    itConstructsLikeThePoller(make);

    it.each(OUTBOUND_PURPOSES)("refuses a URL that is no http or https URL for %s", (purpose) => {
      // Arrange
      const policy = make(perimeterTestDeps());

      // Act
      const allowed = ["file:///etc/passwd", "ftp://files.example/a.pdf", "not a url", "javascript:alert(1)"].map((url) => policy.allows(purpose, url));

      // Assert
      expect(allowed).toEqual([false, false, false, false]);
    });

    it.each(OUTBOUND_PURPOSES)("refuses a URL whose host is a non-public address for %s", (purpose) => {
      // Arrange
      const policy = make(perimeterTestDeps());

      // Act
      const allowed = ["http://127.0.0.1/a.pdf", "http://[::1]/a.pdf", "http://169.254.169.254/opc/v1/instance/", "http://192.168.0.10/a.pdf"].map((url) => policy.allows(purpose, url));

      // Assert
      expect(allowed).toEqual([false, false, false, false]);
    });

    it.each(OUTBOUND_PURPOSES)("hands out a request config object for %s", (purpose) => {
      // Act
      const requestConfig = make(perimeterTestDeps()).requestConfig(purpose);

      // Assert
      expect(typeof requestConfig).toBe("object");
    });

    it("does not report an ordinary failure, or nothing, as a refusal", () => {
      // Arrange
      const policy = make(perimeterTestDeps());

      // Act & Assert
      expect([policy.isBlocked(new Error("socket hang up")), policy.isBlocked(undefined)]).toEqual([false, false]);
    });
  });
}
