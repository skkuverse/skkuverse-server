import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { CAMPUS_BANNERS_LOG_INTERVAL_MS } from "./ui-campus.constants";
import { UiCampusBannersReadError, UiCampusBannersUnavailableError } from "./ui-campus.error";
import { toCampusSheet } from "./ui-campus.mapper";
import { UiCampusRepository } from "./ui-campus.repository";
import { toCampusBannerIssues, withoutUnresolvedBanners } from "./ui-campus.rules";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";
import type { CampusBannerIssue } from "./ui-campus.types";
import type { CampusSheet } from "./ui-campus.wire";

@Injectable()
export class UiCampusService {
  // WHY: a reload every TTL re-finds the same banners; each is logged once per revision this process loads.
  private loggedRevision: number | null = null;
  private readonly loader: DatasetLoader<CampusBannerCarouselRaw>;

  constructor(
    private readonly repository: UiCampusRepository,
    private readonly miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "ui.campus_banners",
      load: () => this.loadCampusBanners(),
      clock,
      isReadError: (err): err is UiCampusBannersReadError => err instanceof UiCampusBannersReadError,
      toUnavailable: () => new UiCampusBannersUnavailableError(),
      readFailedEvent: "ui.campus_banners.read_failed",
      logIntervalMs: CAMPUS_BANNERS_LOG_INTERVAL_MS,
    });
  }

  async getCampusSheet(lang: SupportedLang): Promise<CampusSheet> {
    const banners = await this.loader.get();
    return toCampusSheet({ banners, lang, now: this.clock.now() });
  }

  private async loadCampusBanners(): Promise<CampusBannerCarouselRaw | null> {
    const stored = await this.repository.findCampusBanners();
    if (stored === null) return null;
    const issues = toCampusBannerIssues(stored.banners, this.miniApps);
    this.logLeftOutBanners(stored.revision, issues);
    return withoutUnresolvedBanners(stored.banners, issues);
  }

  private logLeftOutBanners(revision: number, issues: readonly CampusBannerIssue[]): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    for (const { path, message } of issues) {
      logger.error({ event: "ui.campus_banners.item_left_out", revision, path: path.join("."), reason: message }, "Campus banner left out: its action names what the server cannot serve");
    }
  }
}
