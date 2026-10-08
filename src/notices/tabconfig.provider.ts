import type { Provider } from "@nestjs/common";
import { TabConfigService } from "./tabconfig.service";

/**
 * Provider for TabConfigService that forces fail-loud validation at BOOTSTRAP.
 *
 * The useFactory calls `load()` while the DI graph is being constructed, so a
 * malformed categories.json / sources.json crashes the Nest app at boot — the
 * throw propagates out of NestFactory.create rather than surfacing lazily on
 * the first /notices/tabs request. NO `?? []` / try-swallow: a bad config MUST
 * abort startup (per a private note).
 */
export const tabConfigProvider: Provider = {
  provide: TabConfigService,
  useFactory: (): TabConfigService => {
    const svc = new TabConfigService();
    svc.load();
    return svc;
  },
};
