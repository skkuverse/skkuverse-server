import { MiniAppPushAuthorizer, type PerimeterDeps, type PushAuthorization } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

// WHY: allows every sender, signed by no key; the route refuses a signed call over bytes it cannot vouch for.
export class LocalDevMiniAppPushAuthorizer extends MiniAppPushAuthorizer {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "miniAppPushAuthorizer");
  }

  authorize(): Promise<PushAuthorization> {
    return Promise.resolve({ allowed: true, keyId: null });
  }
}
