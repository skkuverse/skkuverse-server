/**
 * The sender rules. What it guards: how the push routes answer MINIAPP_PUSH_AUTHORIZER, and the signed-call
 * refusals the binding applies whatever the implementation decided (ADR 0023, D6).
 */
import type { PushAuthorization, PushCall } from "../../perimeter/perimeter.ports";
import { toPushRefusal } from "./miniapps-sender.rules";

// SEE: docs/decisions/0023-perimeter-ports.md ("D6. Signed calls")
describe("toPushRefusal", () => {
  const call = (method: string, headers: Record<string, string>, rawBody: Buffer | undefined): PushCall => ({
    senderId: "hssc",
    scope: "push.send",
    request: { method, target: "/internal/miniapps/hssc/notifications", ip: undefined, header: (name) => headers[name.toLowerCase()] },
    rawBody,
    credentials: null,
  });
  const body = Buffer.from("{}");

  it.each<[string, PushAuthorization, [number, string] | null]>([
    ["an unauthenticated call", { allowed: false, reason: "unauthenticated" }, [401, "UNAUTHORIZED"]],
    ["a forbidden call", { allowed: false, reason: "forbidden" }, [403, "FORBIDDEN"]],
    ["an unsigned call", { allowed: true, keyId: null }, null],
    ["a signed call", { allowed: true, keyId: "key-1" }, null],
  ])("answers %s with %p", (_label, decision, answer) => {
    // Act
    const refusal = toPushRefusal(call("POST", {}, body), decision);

    // Assert
    expect(refusal === null ? null : [refusal.httpStatus, refusal.code]).toEqual(answer);
  });

  it.each<[string, PushCall, number | null]>([
    ["a body sent with Content-Encoding: gzip", call("POST", { "content-encoding": "gzip" }, body), 401],
    ["a body sent with Content-Encoding: identity", call("POST", { "content-encoding": "identity" }, body), 401],
    ["a POST whose raw body was not captured", call("POST", {}, undefined), 401],
    ["a GET, which has no body", call("GET", {}, undefined), null],
  ])("answers a signed call with %s: %p", (_label, signed, status) => {
    // Act
    const refusal = toPushRefusal(signed, { allowed: true, keyId: "key-1" });

    // Assert
    expect(refusal?.httpStatus ?? null).toBe(status);
  });

  it("lets an unsigned call through whatever its encoding, as the shared push token signs nothing", () => {
    // Act & Assert
    expect(toPushRefusal(call("POST", { "content-encoding": "gzip" }, undefined), { allowed: true, keyId: null })).toBeNull();
  });
});
