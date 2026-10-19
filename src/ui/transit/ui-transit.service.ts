import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import { MiniappsService } from "../../miniapps/miniapps.service";
import { TRANSIT_LAYOUT_LOG_INTERVAL_MS } from "./ui-transit.constants";
import { UiTransitLayoutReadError, UiTransitLayoutUnavailableError } from "./ui-transit.error";
import { UiTransitRepository } from "./ui-transit.repository";
import { isUnplacedIssue, toTransitLayoutIssues, withoutUnresolvedItems } from "./ui-transit.rules";
import type { TransitLayoutRaw } from "./ui-transit.schema";
import type { ServedTransitIds, TransitLayoutIssue, TransitLayoutRevision } from "./ui-transit.types";

// SEE: docs/explanation/ui-architecture.md ("Structure"): the stored transit layout's door for the transit flows.
@Injectable()
export class UiTransitService {
  // WHY: every request re-finds the same issues; each is logged once per revision this process reads.
  private loggedRevision: number | null = null;
  private readonly loader: DatasetLoader<TransitLayoutRevision>;

  constructor(
    private readonly repository: UiTransitRepository,
    private readonly miniApps: MiniappsService,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "ui.transit_layout",
      load: () => this.repository.findTransitLayout(),
      clock,
      isReadError: (err): err is UiTransitLayoutReadError => err instanceof UiTransitLayoutReadError,
      toUnavailable: () => new UiTransitLayoutUnavailableError(),
      readFailedEvent: "ui.transit_layout.read_failed",
      logIntervalMs: TRANSIT_LAYOUT_LOG_INTERVAL_MS,
    });
  }

  async getStoredLayout(served: ServedTransitIds): Promise<TransitLayoutRaw> {
    const stored = await this.loader.get();
    const issues = toTransitLayoutIssues(stored.layout, { ...served, registry: this.miniApps });
    this.logIssues(stored.revision, issues);
    return withoutUnresolvedItems(stored.layout, issues);
  }

  private logIssues(revision: number, issues: readonly TransitLayoutIssue[]): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    for (const issue of issues) {
      const reason = issue.message;
      if (isUnplacedIssue(issue)) logger.error({ event: "ui.transit_layout.unplaced", revision, reason }, "Transit layout leaves a served bus group or station unplaced, not served");
      else logger.error({ event: "ui.transit_layout.item_left_out", revision, path: issue.path.join("."), reason }, "Transit layout item left out: it names what the server cannot serve");
    }
  }
}
