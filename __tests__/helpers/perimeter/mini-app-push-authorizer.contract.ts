/**
 * MINIAPP_PUSH_AUTHORIZER (ADR 0023, D6 and D7): a signed call is checked against the bytes the caller sent, so a
 * body with any Content-Encoding, which the parser hands over decoded, and a POST whose raw body was not captured
 * are unauthenticated, whatever else the call carries.
 */
import type { MiniAppPushAuthorizer, PerimeterDeps, PushCall, SenderCredentials } from "../../../src/perimeter/perimeter.ports";
import { itConstructsLikeThePoller, perimeterRequest, perimeterTestDeps } from "./perimeter-deps";

const ACTIVE: SenderCredentials = { status: "active", scopes: ["push.send", "push.history"], signingKeys: [] };

function sendCall(overrides: Partial<PushCall> = {}, headers: Record<string, string> = {}): PushCall {
  return {
    senderId: "mukja",
    scope: "push.send",
    request: perimeterRequest({ method: "POST", target: "/internal/miniapps/mukja/notifications", headers: { "Content-Type": "application/json", ...headers } }),
    rawBody: Buffer.from('{"title_ko":"t","body_ko":"b"}'),
    credentials: ACTIVE,
    ...overrides,
  };
}

export function describeMiniAppPushAuthorizerContract(make: (deps: PerimeterDeps) => MiniAppPushAuthorizer): void {
  describe("the MINIAPP_PUSH_AUTHORIZER contract", () => {
    itConstructsLikeThePoller(make);

    it.each(["gzip", "identity", "br"])("refuses a body sent with Content-Encoding: %s as unauthenticated", async (encoding) => {
      // Act
      const decision = await make(perimeterTestDeps()).authorize(sendCall({}, { "Content-Encoding": encoding }));

      // Assert
      expect(decision).toEqual({ allowed: false, reason: "unauthenticated" });
    });

    it("refuses a POST whose raw body was not captured as unauthenticated", async () => {
      // Act
      const decision = await make(perimeterTestDeps()).authorize(sendCall({ rawBody: undefined }));

      // Assert
      expect(decision).toEqual({ allowed: false, reason: "unauthenticated" });
    });
  });
}
