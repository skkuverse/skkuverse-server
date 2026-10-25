/**
 * REQUEST_AUTHENTICATOR (ADR 0023, D7): a request with no bearer credential is anonymous, and a bearer
 * credential that does not verify is rejected, never anonymous, so the binding answers it 401.
 */
import type { PerimeterDeps, RequestAuthenticator } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

export function describeRequestAuthenticatorContract(make: (deps: PerimeterDeps) => RequestAuthenticator): void {
  describe("the REQUEST_AUTHENTICATOR contract", () => {
    itConstructsLikeThePoller(make);

    it("treats a request without an Authorization header as anonymous", async () => {
      // Act
      const authentication = await make(perimeterTestDeps()).authenticate(perimeterRequest());

      // Assert
      expect(authentication).toEqual({ kind: "anonymous" });
    });

    it("treats an Authorization header that is no bearer credential as anonymous", async () => {
      // Act
      const authentication = await make(perimeterTestDeps()).authenticate(perimeterRequest({ headers: { Authorization: "Basic dXNlcjpwYXNz" } }));

      // Assert
      expect(authentication).toEqual({ kind: "anonymous" });
    });

    it.each(["Bearer not-a-token", "Bearer "])("rejects the bearer credential %j, which does not verify", async (authorization) => {
      // Act
      const authentication = await make(perimeterTestDeps()).authenticate(perimeterRequest({ headers: { Authorization: authorization } }));

      // Assert
      expect(authentication).toEqual({ kind: "rejected" });
    });
  });
}
