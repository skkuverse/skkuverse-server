import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import { BRIDGE_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import { APP_PLATFORM_GATES_LOG_INTERVAL_MS } from "./app-config.constants";
import type { AppPlatformGates } from "./app-config.document";
import { AppConfigPlatformGatesReadError, AppConfigPlatformGatesUnavailableError } from "./app-config.error";
import { AppConfigRepository } from "./app-config.repository";
import type { AppClientConfig } from "./app-config.wire";

// WHY: the bridge allowlist rides on /app/config because the app already fetches it at boot: the
// list is in hand before the first webview opens, with no second request to wait on.
@Injectable()
export class AppConfigService {
  private readonly platformGatesLoader: DatasetLoader<AppPlatformGates>;

  constructor(
    private readonly repository: AppConfigRepository,
    clock: Clock,
  ) {
    this.platformGatesLoader = createDatasetLoader({
      name: "app_config.platform_gates",
      load: async () => (await this.repository.findPlatformGates())?.data ?? null,
      clock,
      isReadError: (err): err is AppConfigPlatformGatesReadError => err instanceof AppConfigPlatformGatesReadError,
      toUnavailable: () => new AppConfigPlatformGatesUnavailableError(),
      readFailedEvent: "app_config.platform_gates.read_failed",
      logIntervalMs: APP_PLATFORM_GATES_LOG_INTERVAL_MS,
    });
  }

  async getConfig(): Promise<AppClientConfig> {
    const { ios, android } = await this.platformGatesLoader.get();
    return {
      ios: { ...ios },
      android: { ...android },
      webview: { bridgeOrigins: [...BRIDGE_ORIGINS] },
      web: { origin: WEB_ORIGIN },
      miniapps: { origins: { ...MINIAPP_ID_BY_FIRST_PARTY_ORIGIN } },
      games: { origins: { ...GAME_ID_BY_FIRST_PARTY_ORIGIN } },
    };
  }
}
