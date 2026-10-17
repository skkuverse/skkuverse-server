/**
 * Scripted BusEtaProbeClient: each probe route answers the buses the test set
 * for it (none until set), or every call rejects with `failWith`. `calls`
 * records each request, as the real client would spend one from its cap.
 */
import type { BusEtaProbeClient } from "../../../../src/bus/eta/probe/bus-eta-probe.client";
import type { LanePosition } from "../../../../src/bus/eta/probe/bus-eta-probe.types";
import type { PublicOf } from "../public-of";

export class FakeBusEtaProbeClient implements PublicOf<BusEtaProbeClient> {
  positionsByRoute = new Map<string, LanePosition[]>();
  calls: Array<{ routeId: string; now: Date }> = [];
  failWith: Error | null = null;

  async fetchPositions(routeId: string, now: Date, _opts?: { retryDelayMs?: number }): Promise<LanePosition[]> {
    this.calls.push({ routeId, now });
    if (this.failWith) throw this.failWith;
    return this.positionsByRoute.get(routeId) ?? [];
  }
}
