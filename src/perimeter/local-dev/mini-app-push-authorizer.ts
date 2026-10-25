import { MiniAppPushAuthorizer, type PerimeterDeps, type PushAuthorization, type PushCall } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

// WHY: allows every sender, but still refuses what no signature could be checked over (ADR 0023, D6).
export class LocalDevMiniAppPushAuthorizer extends MiniAppPushAuthorizer {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "miniAppPushAuthorizer");
  }

  authorize({ request, rawBody }: PushCall): Promise<PushAuthorization> {
    const isUnverifiable = request.header("content-encoding") !== undefined || (request.method === "POST" && rawBody === undefined);
    return Promise.resolve(isUnverifiable ? { allowed: false, reason: "unauthenticated" } : { allowed: true, keyId: null });
  }
}
