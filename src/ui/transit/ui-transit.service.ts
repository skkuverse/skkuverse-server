import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { toGrammarOnlyRegistry } from "../ui.rules";
import { TRANSIT_LAYOUT_LOG_INTERVAL_MS } from "./ui-transit.constants";
import { UiTransitLayoutReadError, UiTransitLayoutUnavailableError } from "./ui-transit.error";
import { UiTransitRepository } from "./ui-transit.repository";
import { isUnplacedIssue, toTransitLayoutIssues, transitLayoutReferences, withoutUnresolvedItems } from "./ui-transit.rules";
import type { TransitLayoutRaw } from "./ui-transit.schema";
import type { ServedTransitIds, TransitLayoutIssue, TransitLayoutRevision } from "./ui-transit.types";

// SEE: docs/explanation/ui-architecture.md ("Structure"): the stored transit layout's door for the transit flows.
@Injectable()
export class UiTransitService {
  // WHY: every request re-finds the same issues; each is logged once per pair of revisions this process reads.
  private loggedKey: string | null = null;
  private readonly loader: DatasetLoader<TransitLayoutRevision>;

  constructor(
    repository: UiTransitRepository,
    private readonly miniApps: MiniappsService,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "ui.transit_layout",
      load: () => repository.findTransitLayout(),
      clock,
      isReadError: (err): err is UiTransitLayoutReadError => err instanceof UiTransitLayoutReadError,
      toUnavailable: () => new UiTransitLayoutUnavailableError(),
      readFailedEvent: "ui.transit_layout.read_failed",
      logIntervalMs: TRANSIT_LAYOUT_LOG_INTERVAL_MS,
    });
  }

  // SEE: docs/explanation/ui-architecture.md ("Invariants"): the registry is read only when a link names a mini app.
  async getStoredLayout(served: ServedTransitIds): Promise<TransitLayoutRaw> {
    const { revision, layout } = await this.loader.get();
    const isNamingMiniApp = transitLayoutReferences(layout, this.miniApps).some((reference) => reference.dataset === "miniapps");
    const registry = isNamingMiniApp ? await this.miniApps.current() : null;
    const issues = toTransitLayoutIssues(layout, { ...served, registry: registry ?? toGrammarOnlyRegistry(this.miniApps) });
    this.logIssues({ revision, registryRevision: registry?.revision ?? null }, issues);
    return withoutUnresolvedItems(layout, issues);
  }

  private logIssues(revisions: { revision: number; registryRevision: number | null }, issues: readonly TransitLayoutIssue[]): void {
    const key = `${revisions.revision}@${revisions.registryRevision ?? "-"}`;
    if (key === this.loggedKey) return;
    this.loggedKey = key;
    for (const issue of issues) {
      const reason = issue.message;
      if (isUnplacedIssue(issue)) logger.error({ event: "ui.transit_layout.unplaced", ...revisions, reason }, "Transit layout leaves a served bus group or station unplaced, not served");
      else logger.error({ event: "ui.transit_layout.item_left_out", ...revisions, path: issue.path.join("."), reason }, "Transit layout item left out: it names what the server cannot serve");
    }
  }
}
