import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import { FIRST_PARTY_MINIAPP_ORIGINS } from "../../infra/origins";
import { parseShellFields } from "../miniapps.mapper";
import type { ShellConfig } from "../miniapps.wire";
import { MiniappsManifestClient } from "./miniapps-manifest.client";
import { MANIFEST_CACHE_TTL_MS, MANIFEST_STALE_WINDOW_MS, READ_FAILED_LOG_INTERVAL_MS } from "./miniapps-manifest.constants";
import type { StoredManifestShell } from "./miniapps-manifest.document";
import { MiniappsManifestRepository } from "./miniapps-manifest.repository";
import { firstPartyOrigin } from "./miniapps-manifest.rules";

@Injectable()
export class MiniappsManifestService {
  private readonly readFailedThrottle = createLogThrottle(READ_FAILED_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  private readonly storedManifests = createCachedLoader<StoredManifestShell[]>({
    name: "miniapps.miniapp_manifests",
    ttlMs: MANIFEST_CACHE_TTL_MS,
    staleWindowMs: MANIFEST_STALE_WINDOW_MS,
    serveStale: "on-reload-failure",
    load: () => this.repository.listManifests(FIRST_PARTY_MINIAPP_ORIGINS),
  });

  constructor(
    private readonly client: MiniappsManifestClient,
    private readonly repository: MiniappsManifestRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: logs no failure itself; the poller registry reports the rejection, and a failed fetch writes nothing,
  // so the origin's last good manifest stays stored.
  async refresh(origin: string): Promise<void> {
    const shell = await this.client.fetchShellFields(origin);
    await this.repository.upsertManifest(origin, shell, this.clock.now());
  }

  // WHY: `{}` merges as no override: a manifest only restyles the shell, so a missing one never fails a detail.
  async shellFieldsFor(startUrl: string): Promise<Partial<ShellConfig>> {
    const origin = firstPartyOrigin(startUrl, FIRST_PARTY_MINIAPP_ORIGINS);
    if (!origin) return {};
    const stored = (await this.readStoredManifests()).find((manifest) => manifest._id === origin);
    return parseShellFields(stored?.shell);
  }

  private async readStoredManifests(): Promise<readonly StoredManifestShell[]> {
    try {
      return await this.storedManifests.get();
    } catch (err) {
      this.warnReadFailed(err);
      return [];
    }
  }

  private warnReadFailed(err: unknown): void {
    const ticket = this.readFailedThrottle.take("read_failed");
    if (!ticket) return;
    logger.warn(
      { event: "miniapps.manifest.read_failed", err, suppressed: ticket.suppressed },
      "Stored manifests unreadable with none cached; serving the registry's own shells",
    );
  }
}
