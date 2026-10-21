/**
 * In-memory BusRealtimeHsscRepository: feed events by the unique index's key,
 * so an event recorded again is stored once as the real insert leaves it, or
 * every write rejects with `failWith`. `batches` keeps what each call was
 * handed.
 */
import type { HsscFeedEventDoc } from "../../../../src/bus/realtime/hssc/bus-realtime-hssc.document";
import type { BusRealtimeHsscRepository } from "../../../../src/bus/realtime/hssc/bus-realtime-hssc.repository";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeHsscRepository implements PublicOf<BusRealtimeHsscRepository> {
  feedEvents: HsscFeedEventDoc[] = [];
  batches: HsscFeedEventDoc[][] = [];
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async recordFeedEvents(events: HsscFeedEventDoc[]): Promise<number> {
    this.batches.push(events);
    if (this.failWith) throw this.failWith;
    let insertedCount = 0;
    for (const event of events) {
      if (this.feedEvents.some((stored) => keyOf(stored) === keyOf(event))) continue;
      this.feedEvents.push(event);
      insertedCount += 1;
    }
    return insertedCount;
  }
}

function keyOf(event: HsscFeedEventDoc): string {
  return [event.lineNo, event.seq, event.getDate.toISOString(), event.inout].join("|");
}
