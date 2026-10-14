/**
 * The notification rules. What it guards: which failed Cloud Function calls are safe to resend, and that a spent
 * quota is answered with the public rate-limit body. How the routes answer MINIAPP_PUSH_AUTHORIZER is
 * src/miniapps/sender/. A draft's checks are PUSH_CONTENT_POLICY's, tested beside each implementation (ADR 0023, D7).
 */
import { RATE_LIMITED_BODY } from "../../perimeter/perimeter.ports";
import { classifyDeliveryFailure, toQuotaRefusal } from "./miniapps-notifications.rules";

const withStatus = (status: number): Error => Object.assign(new Error(`sendNotification ${status}: x`), { status });

describe("classifyDeliveryFailure", () => {
  it.each([
    [399, "unknown"],
    [400, "not_sent"],
    [408, "unknown"],
    [429, "not_sent"],
    [500, "unknown"],
  ])("reads a %s as %s", (status, outcome) => {
    // Act & Assert
    expect(classifyDeliveryFailure(withStatus(status))).toBe(outcome);
  });

  it("reads an error with no status as unknown", () => {
    // Act & Assert
    expect(classifyDeliveryFailure(new TypeError("fetch failed"))).toBe("unknown");
  });
});

describe("toQuotaRefusal", () => {
  it("answers 429 with the public rate-limit code and message", () => {
    // Act
    const refusal = toQuotaRefusal();

    // Assert
    expect([refusal.httpStatus, { error: { code: refusal.code, message: refusal.message } }]).toEqual([429, RATE_LIMITED_BODY]);
  });
});
