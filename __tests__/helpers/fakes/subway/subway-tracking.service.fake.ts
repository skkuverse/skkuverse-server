/**
 * SubwayTrackingService for a flow that registers with the tracker: it keeps the run matcher and the tick
 * listeners registered, for a spec to call as a tick would, and tracks nothing itself. How a tick calls them is
 * subway-tracking.service.spec.ts's.
 */
import type { SubwayArrivalsDoc } from "../../../../src/subway/subway.document";
import type { SubwayTrackingService } from "../../../../src/subway/tracking/subway-tracking.service";
import type { RunMatcher, TrackedTickListener } from "../../../../src/subway/tracking/subway-tracking.types";
import type { PublicOf } from "../public-of";

export class FakeSubwayTrackingService implements PublicOf<SubwayTrackingService> {
  runMatcher: RunMatcher | null = null;
  tickListeners: TrackedTickListener[] = [];

  async track(): Promise<void> {}

  addTickListener(listener: TrackedTickListener): void {
    this.tickListeners.push(listener);
  }

  setRunMatcher(matcher: RunMatcher): void {
    this.runMatcher = matcher;
  }

  async findScheduledArrivals(): Promise<SubwayArrivalsDoc | null> {
    return null;
  }
}
