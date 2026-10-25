/**
 * (A perimeter detail is left out of the public history.)
 */
import { PUSH_SCOPES, type MiniAppPushAuthorizer, type PerimeterDeps, type PushAuthorization, type SenderCredentials } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

const CREDENTIALS: ReadonlyArray<readonly [string, SenderCredentials | null]> = [
  ["an active sender", { status: "active", scopes: ["push.send", "push.history"], signingKeys: [] }],
  ["a pending sender with no scopes", { status: "pending", scopes: [], signingKeys: [] }],
  ["a suspended sender", { status: "suspended", scopes: ["push.send"], signingKeys: [{ keyId: "key-1", publicKey: "not-a-key" }] }],
  ["an unknown sender", null],
];

function isWellFormed(decision: PushAuthorization): boolean {
  if (decision.allowed) return decision.keyId === null || typeof decision.keyId === "string";
  return decision.reason === "unauthenticated" || decision.reason === "forbidden";
}

export function describeMiniAppPushAuthorizerContract(make: (deps: PerimeterDeps) => MiniAppPushAuthorizer): void {
  describe("the MINIAPP_PUSH_AUTHORIZER contract", () => {
    itConstructsLikeThePoller(make);

    describe.each(PUSH_SCOPES)("under %s", (scope) => {
      it.each(CREDENTIALS)("answers %s with a well-formed decision, without throwing", async (_label, credentials) => {
        // Arrange
        const method = scope === "push.send" ? "POST" : "GET";
        const request = perimeterRequest({ method, target: "/internal/miniapps/mukja/notifications", headers: { "Content-Type": "application/json" } });
        const rawBody = method === "POST" ? Buffer.from('{"title_ko":"t","body_ko":"b"}') : undefined;

        // Act
        const decision = await make(perimeterTestDeps()).authorize({ senderId: "mukja", scope, request, rawBody, credentials });

        // Assert
        expect(isWellFormed(decision)).toBe(true);
      });
    });
  });
}
