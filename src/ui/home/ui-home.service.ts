import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import type { SupportedLang } from "../../infra/types";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { toGrammarOnlyRegistry } from "../ui.rules";
import { HOME_LAYOUT_LOG_INTERVAL_MS } from "./ui-home.constants";
import { UiHomeLayoutReadError, UiHomeLayoutUnavailableError } from "./ui-home.error";
import { toHomeLayout } from "./ui-home.mapper";
import { UiHomeRepository } from "./ui-home.repository";
import { homeLayoutReferences, toHomeLayoutIssues, withoutUnresolvedItems } from "./ui-home.rules";
import type { HomeLayoutRaw } from "./ui-home.schema";
import type { HomeLayoutIssue, HomeLayoutRevision, ResolvedHomeLayout } from "./ui-home.types";
import type { HomeLayout } from "./ui-home.wire";

// SEE: docs/explanation/ui-architecture.md ("Invariants"): one registry snapshot per request, only when the layout names a mini app.
@Injectable()
export class UiHomeService {
  // WHY: the filter runs once per pair of revisions, so each left-out item is logged once per pair, not per request.
  private resolved: ResolvedHomeLayout | null = null;
  private readonly loader: DatasetLoader<HomeLayoutRevision>;

  constructor(
    repository: UiHomeRepository,
    private readonly miniApps: MiniappsService,
    private readonly clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "ui.home_layout",
      load: () => repository.findHomeLayout(),
      clock,
      isReadError: (err): err is UiHomeLayoutReadError => err instanceof UiHomeLayoutReadError,
      toUnavailable: () => new UiHomeLayoutUnavailableError(),
      readFailedEvent: "ui.home_layout.read_failed",
      logIntervalMs: HOME_LAYOUT_LOG_INTERVAL_MS,
    });
  }

  async getHomeLayout(lang: SupportedLang): Promise<HomeLayout> {
    const layout = await this.resolvedLayout(await this.loader.get());
    const resolveLogo = this.miniApps.resolveLogo.bind(this.miniApps);
    return toHomeLayout(layout, { lang, now: this.clock.now(), resolveLogo });
  }

  private async resolvedLayout({ revision, layout }: HomeLayoutRevision): Promise<HomeLayoutRaw> {
    const namesMiniApp = homeLayoutReferences(layout, this.miniApps).some((reference) => reference.dataset === "miniapps");
    const registry = namesMiniApp ? await this.miniApps.current() : null;
    const key = `${revision}@${registry?.revision ?? "-"}`;
    if (this.resolved?.key === key) return this.resolved.layout;
    const issues = toHomeLayoutIssues(layout, registry ?? toGrammarOnlyRegistry(this.miniApps));
    this.logLeftOutItems({ revision, registryRevision: registry?.revision ?? null }, issues);
    this.resolved = { key, layout: withoutUnresolvedItems(layout, issues) };
    return this.resolved.layout;
  }

  private logLeftOutItems(revisions: { revision: number; registryRevision: number | null }, issues: readonly HomeLayoutIssue[]): void {
    for (const { path, message } of issues) {
      logger.error({ event: "ui.home_layout.item_left_out", ...revisions, path: path.join("."), reason: message }, "Home layout item left out: it names what the server cannot serve");
    }
  }
}
