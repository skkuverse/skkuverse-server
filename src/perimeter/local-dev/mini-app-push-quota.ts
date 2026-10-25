import { MiniAppPushQuota, type PerimeterDeps, type QuotaDecision } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

export class LocalDevMiniAppPushQuota extends MiniAppPushQuota {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "miniAppPushQuota");
  }

  take(): Promise<QuotaDecision> {
    return Promise.resolve({ allowed: true });
  }
}
