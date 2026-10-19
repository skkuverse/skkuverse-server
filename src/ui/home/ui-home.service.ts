import { Injectable } from "@nestjs/common";
import { createCachedLoader } from "../../infra/cached-loader";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { DATASET_CACHE_TTL_MS, DATASET_STALE_WINDOW_MS } from "../../shared/dataset.constants";
import { UiHomeLayoutUnavailableError } from "./ui-home.error";
import { toHomeLayout } from "./ui-home.mapper";
import { UiHomeRepository } from "./ui-home.repository";
import { toHomeLayoutIssues, withoutUnresolvedItems } from "./ui-home.rules";
import type { HomeLayoutRaw } from "./ui-home.schema";
import type { HomeLayoutIssue } from "./ui-home.types";
import type { HomeLayout } from "./ui-home.wire";

@Injectable()
export class UiHomeService {
  // WHY: a reload every TTL re-finds the same items; each is logged once per revision this process loads.
  private loggedRevision: number | null = null;
  private readonly loader = createCachedLoader({
    name: "ui.home_layout",
    ttlMs: DATASET_CACHE_TTL_MS,
    staleWindowMs: DATASET_STALE_WINDOW_MS,
    serveStale: "on-reload-failure",
    load: () => this.loadHomeLayout(),
  });

  constructor(
    private readonly repository: UiHomeRepository,
    private readonly miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {}

  async getHomeLayout(lang: SupportedLang): Promise<HomeLayout> {
    const layout = await this.cachedHomeLayout();
    const resolveLogo = this.miniApps.resolveLogo.bind(this.miniApps);
    return toHomeLayout(layout, { lang, now: this.clock.now(), resolveLogo });
  }

  private async cachedHomeLayout(): Promise<HomeLayoutRaw> {
    try {
      return await this.loader.get();
    } catch (err) {
      if (err instanceof UiHomeLayoutUnavailableError) throw err;
      logger.error({ event: "ui.home_layout.read_failed", err }, "Home layout unreadable with none cached");
      throw new UiHomeLayoutUnavailableError();
    }
  }

  private async loadHomeLayout(): Promise<HomeLayoutRaw> {
    const stored = await this.repository.findHomeLayout();
    if (stored === null) throw new UiHomeLayoutUnavailableError();
    const issues = toHomeLayoutIssues(stored.layout, this.miniApps);
    this.logLeftOutItems(stored.revision, issues);
    return withoutUnresolvedItems(stored.layout, issues);
  }

  private logLeftOutItems(revision: number, issues: readonly HomeLayoutIssue[]): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    for (const { path, message } of issues) {
      logger.error({ event: "ui.home_layout.item_left_out", revision, path: path.join("."), reason: message }, "Home layout item left out: it names what the server cannot serve");
    }
  }
}
