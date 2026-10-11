import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../http/cache-control.decorator";
import { AppConfigService } from "./app-config.service";
import type { AppClientConfig } from "./app-config.types";

// WHY: the body is read at boot and the same for every client; five minutes bounds how long a raised
// minimum version takes to reach a cold start once the replicas restart with it.
const APP_CONFIG_CACHE_CONTROL = "public, max-age=300";

@Controller("app")
export class AppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get("config")
  @CacheControl(APP_CONFIG_CACHE_CONTROL)
  getConfig(): AppClientConfig {
    return this.appConfig.getConfig();
  }
}
