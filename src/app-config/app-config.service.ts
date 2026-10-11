import { Injectable } from "@nestjs/common";
import config from "../infra/config";
import { BRIDGE_ORIGINS, WEB_ORIGIN } from "../infra/origins";
import { MiniAppsService } from "../miniapps/miniapps.service";
import type { AppClientConfig } from "./app-config.wire";

// WHY: the bridge allowlist rides on /app/config because the app already fetches it at boot: the
// list is in hand before the first webview opens, with no second request to wait on.
@Injectable()
export class AppConfigService {
  constructor(private readonly miniApps: MiniAppsService) {}

  getConfig(): AppClientConfig {
    const { ios, android } = config.app;
    return {
      ios,
      android,
      webview: { bridgeOrigins: [...BRIDGE_ORIGINS] },
      web: { origin: WEB_ORIGIN },
      miniapps: { origins: { ...this.miniApps.firstPartyOrigins } },
    };
  }
}
