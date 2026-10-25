/**
 * INTERNAL_AUTHORIZER (ADR 0023, D7): a decision is a boolean, never a throw, for every scope, whether the
 * caller sent a credential or not, so the guard answers 401 for a refusal instead of 500.
 */
import { INTERNAL_SCOPES, type InternalAuthorizer, type PerimeterDeps } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

export function describeInternalAuthorizerContract(make: (deps: PerimeterDeps) => InternalAuthorizer, deps: () => PerimeterDeps = perimeterTestDeps): void {
  describe("the INTERNAL_AUTHORIZER contract", () => {
    itConstructsLikeThePoller(make);

    it.each(INTERNAL_SCOPES)("answers %s with a boolean, with or without a credential", async (scope) => {
      // Arrange
      const authorizer = make(deps());

      // Act
      const decisions = [
        await authorizer.authorize(scope, perimeterRequest({ method: "POST", target: "/internal/x" })),
        await authorizer.authorize(scope, perimeterRequest({ method: "POST", target: "/internal/x", headers: { "X-Internal-Token": "not-the-token" } })),
      ];

      // Assert
      expect(decisions.map((decision) => typeof decision)).toEqual(["boolean", "boolean"]);
    });
  });
}
