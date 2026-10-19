import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { HOME_LAYOUT_LOG_INTERVAL_MS } from "./ui-home.constants";
import { UiHomeLayoutReadError, UiHomeLayoutUnavailableError } from "./ui-home.error";
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
  private readonly loader: DatasetLoader<HomeLayoutRaw>;

  constructor(
    private readonly repository: UiHomeRepository,
    private readonly miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "ui.home_layout",
      load: () => this.loadHomeLayout(),
      clock,
      isReadError: (err): err is UiHomeLayoutReadError => err instanceof UiHomeLayoutReadError,
      toUnavailable: () => new UiHomeLayoutUnavailableError(),
      readFailedEvent: "ui.home_layout.read_failed",
      logIntervalMs: HOME_LAYOUT_LOG_INTERVAL_MS,
    });
  }

  async getHomeLayout(lang: SupportedLang): Promise<HomeLayout> {
    const layout = await this.loader.get();
    const resolveLogo = this.miniApps.resolveLogo.bind(this.miniApps);
    return toHomeLayout(layout, { lang, now: this.clock.now(), resolveLogo });
  }

  private async loadHomeLayout(): Promise<HomeLayoutRaw | null> {
    const stored = await this.repository.findHomeLayout();
    if (stored === null) return null;
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
