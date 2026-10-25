/**
 * MINIAPP_PUSH_AUTHORIZER (ADR 0023, D7): a decision resolves, allowed with a key id or none, or refused as
 * unauthenticated or forbidden, never a throw or a rejection, for every scope, for a
 * GET, a POST with its raw body and a POST without one, and for an active, pending, suspended or unknown sender, so
 * the route answers 401 or 403 for a refusal instead of 500. A body sent with a Content-Encoding, or a POST whose
 * raw body is missing, is refused by the route for every signed decision (`toPushRefusal`), not here. Which calls are
 * allowed is policy, tested beside the implementation that holds it.
 */
import { PUSH_SCOPES, type MiniAppPushAuthorizer, type PerimeterDeps, type PerimeterRequest, type PushAuthorization, type SenderCredentials } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

const TARGET = "/internal/miniapps/mukja/notifications";
const HEADERS = { "Content-Type": "application/json" };

const CALLS: ReadonlyArray<readonly [string, PerimeterRequest, Buffer | undefined]> = [
  ["a GET", perimeterRequest({ method: "GET", target: TARGET, headers: {} }), undefined],
  ["a POST with its raw body", perimeterRequest({ method: "POST", target: TARGET, headers: HEADERS }), Buffer.from('{"title_ko":"t","body_ko":"b"}')],
  ["a POST without a raw body", perimeterRequest({ method: "POST", target: TARGET, headers: HEADERS }), undefined],
];

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

const CASES = CALLS.flatMap(([call, request, rawBody]) => CREDENTIALS.map(([sender, credentials]) => [call, sender, request, rawBody, credentials] as const));

export function describeMiniAppPushAuthorizerContract(make: (deps: PerimeterDeps) => MiniAppPushAuthorizer): void {
  describe("the MINIAPP_PUSH_AUTHORIZER contract", () => {
    itConstructsLikeThePoller(make);

    describe.each(PUSH_SCOPES)("under %s", (scope) => {
      it.each(CASES)("answers %s from %s with a well-formed decision, without throwing", async (_call, _sender, request, rawBody, credentials) => {
        // Act
        const decision = Promise.resolve().then(() => make(perimeterTestDeps()).authorize({ senderId: "mukja", scope, request, rawBody, credentials }));

        // Assert
        await expect(decision.then(isWellFormed)).resolves.toBe(true);
      });
    });
  });
}
