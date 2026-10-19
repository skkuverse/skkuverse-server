import { Injectable, type OnModuleInit } from "@nestjs/common";
import { createCachedLoader, type CachedLoader } from "../../infra/cached-loader";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { MiniAppDetailRaw } from "../miniapps.schema";
import { MiniappsService } from "../miniapps.service";
import type { ShellConfig } from "../miniapps.wire";
import { MiniappsManifestService } from "../manifest/miniapps-manifest.service";
import { CACHE_TTL_MS, FETCH_FAILED_LOG_INTERVAL_MS } from "./miniapps-catalog.constants";

// WHY: once a manifest has loaded, a mini app's own outage must never fail or hang its own detail.
const STALE_FOREVER_MS = Number.MAX_SAFE_INTEGER;

type ShellFields = Partial<ShellConfig>;

@Injectable()
export class MiniappsCatalogClient implements OnModuleInit {
  private readonly loaders = new Map<string, CachedLoader<ShellFields>>();
  private readonly fetchFailedThrottle = createLogThrottle(FETCH_FAILED_LOG_INTERVAL_MS);

  constructor(
    private readonly miniApps: MiniappsService,
    private readonly manifests: MiniappsManifestService,
  ) {}

  // WHY: fire-and-forget, so the boot never waits on a network call, and one mini app down stops no other's prefetch.
  onModuleInit(): void {
    for (const detail of this.miniApps.map.values()) {
      const origin = this.manifests.firstPartyOriginOf(detail.startUrl);
      if (!origin) continue;
      this.loaderFor(detail.id, origin)
        .get()
        .catch((err: unknown) => {
          logger.warn(
            { event: "miniapps.manifest.prefetch_failed", miniAppId: detail.id, origin, err },
            "Manifest prefetch failed; serving the registry's own shell for now",
          );
        });
    }
  }

  // WHY: `{}` merges as no override, so a mini app with no manifest, or one failing, keeps the registry's shell.
  async fetchShellFields(detail: Pick<MiniAppDetailRaw, "id" | "startUrl">): Promise<ShellFields> {
    const origin = this.manifests.firstPartyOriginOf(detail.startUrl);
    if (!origin) return {};
    try {
      return await this.loaderFor(detail.id, origin).get();
    } catch (err) {
      this.warnFetchFailed(detail.id, origin, err);
      return {};
    }
  }

  private warnFetchFailed(miniAppId: string, origin: string, err: unknown): void {
    const ticket = this.fetchFailedThrottle.take(miniAppId);
    if (!ticket) return;
    logger.warn(
      { event: "miniapps.manifest.fetch_failed", miniAppId, origin, err, suppressed: ticket.suppressed },
      "Manifest fetch failed; serving the registry's own shell",
    );
  }

  private loaderFor(id: string, origin: string): CachedLoader<ShellFields> {
    const existing = this.loaders.get(id);
    if (existing) return existing;
    const loader = createCachedLoader<ShellFields>({
      name: `miniapp-manifest:${id}`,
      ttlMs: CACHE_TTL_MS,
      staleWindowMs: STALE_FOREVER_MS,
      load: () => this.manifests.fetchShellFields(origin),
      // WHY: the manifest is on the mini app's production origin, not in a _dev database; uncached, every open waits on it.
      keepWhenCacheOff: true,
    });
    this.loaders.set(id, loader);
    return loader;
  }
}
