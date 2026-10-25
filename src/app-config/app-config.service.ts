import { Injectable } from "@nestjs/common";
import config from "../infra/config";
import { BRIDGE_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import type { AppClientConfig } from "./app-config.wire";

// WHY: the bridge allowlist rides on /app/config because the app already fetches it at boot: the
// list is in hand before the first webview opens, with no second request to wait on.
@Injectable()
export class AppConfigService {
  getConfig(): Promise<AppClientConfig> {
    const { ios, android } = config.app;
    return Promise.resolve({
      ios,
      android,
      webview: { bridgeOrigins: [...BRIDGE_ORIGINS] },
      web: { origin: WEB_ORIGIN },
      miniapps: { origins: { ...MINIAPP_ID_BY_FIRST_PARTY_ORIGIN } },
      games: { origins: { ...GAME_ID_BY_FIRST_PARTY_ORIGIN } },
    });
  }
}
