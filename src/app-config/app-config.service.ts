import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import config from "../infra/config";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import { BRIDGE_ORIGINS, GAME_ID_BY_FIRST_PARTY_ORIGIN, MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import { APP_FEATURES_LOG_INTERVAL_MS, APP_FEATURES_WHEN_UNREAD } from "./app-config.constants";
import { AppConfigFeaturesReadError, AppConfigFeaturesUnavailableError } from "./app-config.error";
import { AppConfigRepository } from "./app-config.repository";
import type { AppFeatures } from "./app-config.types";
import type { AppClientConfig } from "./app-config.wire";

// WHY: the bridge allowlist rides on /app/config because the app already fetches it at boot: the
// list is in hand before the first webview opens, with no second request to wait on.
@Injectable()
export class AppConfigService {
  private readonly featuresLoader: DatasetLoader<AppFeatures>;

  constructor(
    private readonly repository: AppConfigRepository,
    clock: Clock,
  ) {
    this.featuresLoader = createDatasetLoader({
      name: "app_config.features",
      load: async () => (await this.repository.findFeatures())?.data ?? null,
      clock,
      isReadError: (err): err is AppConfigFeaturesReadError => err instanceof AppConfigFeaturesReadError,
      toUnavailable: () => new AppConfigFeaturesUnavailableError(),
      readFailedEvent: "app_config.features.read_failed",
      logIntervalMs: APP_FEATURES_LOG_INTERVAL_MS,
    });
  }

  async getConfig(): Promise<AppClientConfig> {
    const { ios, android } = config.app;
    return {
      ios,
      android,
      webview: { bridgeOrigins: [...BRIDGE_ORIGINS] },
      web: { origin: WEB_ORIGIN },
      miniapps: { origins: { ...MINIAPP_ID_BY_FIRST_PARTY_ORIGIN } },
      games: { origins: { ...GAME_ID_BY_FIRST_PARTY_ORIGIN } },
      features: await this.findFeatures(),
    };
  }

  // WHY: a kill switch fails off, never as a 503 on the route the force-update gate reads; the repository
  // and the loader log each cause at error.
  private async findFeatures(): Promise<AppFeatures> {
    try {
      return { ...(await this.featuresLoader.get()) };
    } catch (err) {
      if (err instanceof AppConfigFeaturesUnavailableError) return { ...APP_FEATURES_WHEN_UNREAD };
      throw err;
    }
  }
}
