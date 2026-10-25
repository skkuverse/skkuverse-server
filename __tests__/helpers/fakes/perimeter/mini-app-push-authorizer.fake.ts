import type { MiniAppPushAuthorizer, PushAuthorization, PushCall } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Answers every call with `authorization`, allowed with no key until a test sets it, and keeps the calls. */
export class FakeMiniAppPushAuthorizer implements PublicOf<MiniAppPushAuthorizer> {
  authorization: PushAuthorization = { allowed: true, keyId: null };
  readonly calls: PushCall[] = [];

  authorize(call: PushCall): Promise<PushAuthorization> {
    this.calls.push(call);
    return Promise.resolve(this.authorization);
  }
}
