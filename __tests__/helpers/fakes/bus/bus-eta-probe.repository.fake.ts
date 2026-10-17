/**
 * In-memory BusEtaProbeRepository: spans by `_id`, so a span recorded again
 * replaces itself as the real bulk replace does. `recordCalls` counts the
 * writes.
 */
import type { BusLaneSpanDoc } from "../../../../src/bus/eta/probe/bus-eta-probe.document";
import type { BusEtaProbeRepository } from "../../../../src/bus/eta/probe/bus-eta-probe.repository";
import type { PublicOf } from "../public-of";

export class FakeBusEtaProbeRepository implements PublicOf<BusEtaProbeRepository> {
  spans = new Map<string, BusLaneSpanDoc>();
  recordCalls = 0;

  async onModuleInit(): Promise<void> {}

  async recordSpans(spans: BusLaneSpanDoc[]): Promise<number> {
    this.recordCalls += 1;
    for (const span of spans) this.spans.set(span._id, span);
    return spans.length;
  }
}
