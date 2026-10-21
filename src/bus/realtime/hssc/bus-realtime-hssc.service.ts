import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import type { HsscApiBus, HsscBusDoc } from "../../cache/bus-cache.document";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import { toHsscBus, toHsscFeedEventDoc } from "./bus-realtime-hssc.mapper";
import { BusRealtimeHsscRepository } from "./bus-realtime-hssc.repository";
import {
  isFresh,
  toDwellSeconds,
  toFeedEventKey,
  toFeedEventTiming,
  toFirstSeenAt,
  toLinearSequence,
} from "./bus-realtime-hssc.rules";

@Injectable()
export class BusRealtimeHsscService {
  private buses: HsscBusDoc[] = [];
  private previousFeedEventKeys = new Set<string>();

  constructor(
    private readonly client: BusRealtimeHsscClient,
    private readonly cache: BusCacheService,
    private readonly feedEvents: BusRealtimeHsscRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: rejects on a failed fetch or bus_cache write, so the poller registry reports the tick; api replicas
  // read bus_cache, so a failed write is a failed tick.
  async refresh(): Promise<void> {
    const items = await this.client.fetchBuses();
    const now = this.clock.now();
    this.buses = items
      .map((item) => {
        const firstSeenAt = toFirstSeenAt(item, this.buses);
        const sequence = toLinearSequence(parseInt(item.seq, 10));
        return toHsscBus(item, { sequence, firstSeenAt, dwellSeconds: toDwellSeconds(firstSeenAt, now) });
      })
      .filter((bus) => isFresh(bus, now));
    await this.cache.write("hssc", this.buses);
    await this.recordFeedEvents(items, now);
  }

  // WHY: every row, stale ones included, since the log is a timeline of stop events; a key is forgotten only once
  // its write succeeded, and the unique index stores an event a restarted poller sends again once.
  private async recordFeedEvents(items: HsscApiBus[], polledAt: Date): Promise<void> {
    const keys = new Set(items.map(toFeedEventKey));
    const events = items
      .filter((item) => !this.previousFeedEventKeys.has(toFeedEventKey(item)))
      .flatMap((item) => {
        const timing = toFeedEventTiming(item);
        return timing ? [toHsscFeedEventDoc(item, timing, polledAt)] : [];
      });
    await this.feedEvents.recordFeedEvents(events);
    this.previousFeedEventKeys = keys;
  }

  // WHY: never the poller's own memory, so combined answers as an api replica does (ADR 0012, D1).
  async listBuses(): Promise<HsscBusDoc[]> {
    return (await this.cache.read("hssc")) ?? [];
  }
}
