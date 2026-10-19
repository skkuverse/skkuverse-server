import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { toGrammarOnlyRegistry } from "../ui.rules";
import { CAMPUS_BANNERS_LOG_INTERVAL_MS } from "./ui-campus.constants";
import { UiCampusBannersReadError, UiCampusBannersUnavailableError } from "./ui-campus.error";
import { toCampusSheet } from "./ui-campus.mapper";
import { UiCampusRepository } from "./ui-campus.repository";
import { campusBannerReferences, toCampusBannerIssues, withoutUnresolvedBanners } from "./ui-campus.rules";
import type { CampusBannerCarouselRaw } from "./ui-campus.schema";
import type { CampusBannerIssue, CampusBannersRevision, ResolvedCampusBanners } from "./ui-campus.types";
import type { CampusSheet } from "./ui-campus.wire";

// SEE: docs/explanation/ui-architecture.md ("Invariants"): one registry snapshot per request, only when a banner names a mini app.
@Injectable()
export class UiCampusService {
  // WHY: the filter runs once per pair of revisions, so each left-out banner is logged once per pair, not per request.
  private resolved: ResolvedCampusBanners | null = null;
  private readonly loader: DatasetLoader<CampusBannersRevision>;

  constructor(
    repository: UiCampusRepository,
    private readonly miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "ui.campus_banners",
      load: () => repository.findCampusBanners(),
      clock,
      isReadError: (err): err is UiCampusBannersReadError => err instanceof UiCampusBannersReadError,
      toUnavailable: () => new UiCampusBannersUnavailableError(),
      readFailedEvent: "ui.campus_banners.read_failed",
      logIntervalMs: CAMPUS_BANNERS_LOG_INTERVAL_MS,
    });
  }

  async getCampusSheet(lang: SupportedLang): Promise<CampusSheet> {
    const banners = await this.resolvedBanners(await this.loader.get());
    return toCampusSheet({ banners, lang, now: this.clock.now() });
  }

  private async resolvedBanners({ revision, banners }: CampusBannersRevision): Promise<CampusBannerCarouselRaw> {
    const registry = campusBannerReferences(banners, this.miniApps).length > 0 ? await this.miniApps.current() : null;
    const key = `${revision}@${registry?.revision ?? "-"}`;
    if (this.resolved?.key === key) return this.resolved.banners;
    const issues = toCampusBannerIssues(banners, registry ?? toGrammarOnlyRegistry(this.miniApps));
    this.logLeftOutBanners({ revision, registryRevision: registry?.revision ?? null }, issues);
    this.resolved = { key, banners: withoutUnresolvedBanners(banners, issues) };
    return this.resolved.banners;
  }

  private logLeftOutBanners(revisions: { revision: number; registryRevision: number | null }, issues: readonly CampusBannerIssue[]): void {
    for (const { path, message } of issues) {
      logger.error({ event: "ui.campus_banners.item_left_out", ...revisions, path: path.join("."), reason: message }, "Campus banner left out: its action names what the server cannot serve");
    }
  }
}
