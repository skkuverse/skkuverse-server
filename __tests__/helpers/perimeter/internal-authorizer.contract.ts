/**
 * INTERNAL_AUTHORIZER (ADR 0023, D7): a decision is a boolean, never a throw, for every scope and for a missing,
 * empty, wrong or malformed credential, so the guard answers 401 for a refusal instead of 500. Which credentials it
 * accepts is policy, tested beside the implementation that holds it.
 */
import { INTERNAL_SCOPES, type InternalAuthorizer, type PerimeterDeps } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

const CREDENTIALS: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ["no header", {}],
  ["an empty header", { "X-Internal-Token": "" }],
  ["a wrong token", { "X-Internal-Token": "not-the-token" }],
  ["a 4 KiB token", { "X-Internal-Token": "x".repeat(4096) }],
  ["a non-ASCII token", { "X-Internal-Token": "토큰-\u0000-é" }],
  ["a token wrapped in spaces", { "X-Internal-Token": "  token  " }],
];

export function describeInternalAuthorizerContract(make: (deps: PerimeterDeps) => InternalAuthorizer, deps: () => PerimeterDeps = perimeterTestDeps): void {
  describe("the INTERNAL_AUTHORIZER contract", () => {
    itConstructsLikeThePoller(make);

    describe.each(INTERNAL_SCOPES)("under %s", (scope) => {
      it.each(CREDENTIALS)("answers %s with a boolean, without throwing", async (_label, headers) => {
        // Act
        const decision = make(deps()).authorize(scope, perimeterRequest({ method: "POST", target: "/internal/x", headers }));

        // Assert
        await expect(decision).resolves.toEqual(expect.any(Boolean));
      });
    });
  });
}
