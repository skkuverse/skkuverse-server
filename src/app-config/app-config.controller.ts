import { Controller, Get } from "@nestjs/common";
import { CacheControl } from "../http/cache-control.decorator";
import { AppConfigService } from "./app-config.service";
import type { AppClientConfig } from "./app-config.wire";

// WHY: the same body for every client, so a shared cache may keep it. EVIDENCE: Cloudflare's edge serves it from
// cache (cf-cache-status HIT, 2026-10-23); a minute keeps a raised gate near the replicas' own minute.
const APP_CONFIG_CACHE_CONTROL = "public, max-age=60";

@Controller("app")
export class AppConfigController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get("config")
  @CacheControl(APP_CONFIG_CACHE_CONTROL)
  getConfig(): Promise<AppClientConfig> {
    return this.appConfig.getConfig();
  }
}
