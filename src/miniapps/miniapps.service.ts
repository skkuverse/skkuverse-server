import { Injectable } from "@nestjs/common";
import { Clock } from "../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../infra/dataset-loader";
import logger from "../infra/logger";
import { MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, WEB_ORIGIN } from "../infra/origins";
import type { MiniAppTarget } from "../shared/miniapp-target.types";
import { parseMiniAppTarget } from "../shared/miniapp-target.util";
import { WEBVIEW_ORIGIN } from "../shared/webview-origin.constants";
import { REGISTRY_LOG_INTERVAL_MS } from "./miniapps.constants";
import { MiniappsRegistryReadError, MiniappsRegistryUnavailableError } from "./miniapps.error";
import { resolveLogo, toMiniAppRegistry } from "./miniapps.mapper";
import { MiniappsRepository } from "./miniapps.repository";
import { isSingleEmoji, toRegistryIssues } from "./miniapps.rules";
import type { MiniAppLogoRaw } from "./miniapps.schema";
import type { MiniAppRegistry, MiniAppsRegistryRevision } from "./miniapps.types";
import type { MiniAppLogo } from "./miniapps.wire";

// SEE: docs/decisions/0010-server-architecture.md (D1): the door other features read the registry through.
@Injectable()
export class MiniappsService {
  // WHY: a reload every TTL re-finds the same mismatch; it is logged once per revision this process loads.
  private loggedRevision: number | null = null;
  private readonly loader: DatasetLoader<MiniAppRegistry>;

  constructor(
    private readonly repository: MiniappsRepository,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "miniapps.registry",
      load: () => this.loadRegistry(),
      clock,
      isReadError: (err): err is MiniappsRegistryReadError => err instanceof MiniappsRegistryReadError,
      toUnavailable: () => new MiniappsRegistryUnavailableError(),
      readFailedEvent: "miniapps.registry.read_failed",
      logIntervalMs: REGISTRY_LOG_INTERVAL_MS,
    });
  }

  current(): Promise<MiniAppRegistry> {
    return this.loader.get();
  }

  // WHY: for a reader whose documented degraded answer serves without the registry rather than a 503.
  async findCurrent(): Promise<MiniAppRegistry | null> {
    try {
      return await this.loader.get();
    } catch (err) {
      if (err instanceof MiniappsRegistryUnavailableError) return null;
      throw err;
    }
  }

  parseTarget(value: unknown): MiniAppTarget | null {
    return parseMiniAppTarget(value);
  }

  resolveLogo(logo: MiniAppLogoRaw): MiniAppLogo {
    return resolveLogo(logo, WEB_ORIGIN);
  }

  isSingleEmoji(value: string): boolean {
    return isSingleEmoji(value);
  }

  private async loadRegistry(): Promise<MiniAppRegistry | null> {
    const stored = await this.repository.findRegistry();
    if (stored === null) return null;
    this.logOwnerMismatches(stored);
    return toMiniAppRegistry(stored.registry, stored.revision, WEB_ORIGIN);
  }

  private logOwnerMismatches({ revision, registry }: MiniAppsRegistryRevision): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    for (const { path, message } of toRegistryIssues(registry, { owners: MINIAPP_ID_BY_FIRST_PARTY_ORIGIN, webviewOrigin: WEBVIEW_ORIGIN })) {
      logger.error({ event: "miniapps.registry.owner_mismatch", revision, path: path.join("."), reason: message }, "Mini app registry disagrees with the first-party origin owners in code");
    }
  }
}
