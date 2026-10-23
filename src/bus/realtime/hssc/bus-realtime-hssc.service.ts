import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import logger from "../../../infra/logger";
import type { HsscApiBus, HsscBusDoc } from "../../cache/bus-cache.document";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import { toHsscBus, toHsscFeedEventDoc, withAnchorRow } from "./bus-realtime-hssc.mapper";
import { BusRealtimeHsscRepository } from "./bus-realtime-hssc.repository";
import {
  isFresh,
  isLiveFresh,
  isUnparsedFeed,
  toDwellSeconds,
  toFeedEventKey,
  toFeedEventTiming,
  toFirstSeenAt,
  toHeldAnchorRow,
  toHsscStopEvent,
  toLinearSequence,
} from "./bus-realtime-hssc.rules";
import type { HsscStopEvent, HsscStopEvents } from "./bus-realtime-hssc.types";

@Injectable()
export class BusRealtimeHsscService {
  private buses: HsscBusDoc[] = [];
  private previousFeedEventKeys = new Set<string>();
  private isFeedUnparsed = false;

  constructor(
    private readonly client: BusRealtimeHsscClient,
    private readonly cache: BusCacheService,
    private readonly feedEvents: BusRealtimeHsscRepository,
    private readonly clock: Clock,
  ) {}

  // WHY: rejects on a failed fetch or bus_cache write, so the poller registry reports the tick; api replicas
  // read bus_cache, so a failed write is a failed tick. It keeps the live route's layover window, the widest.
  async refresh(): Promise<void> {
    const items = await this.client.fetchBuses();
    const now = this.clock.now();
    this.buses = items
      .map((item) => {
        const firstSeenAt = toFirstSeenAt(item, this.buses);
        const sequence = toLinearSequence(parseInt(item.seq, 10));
        return toHsscBus(item, { sequence, firstSeenAt, dwellSeconds: toDwellSeconds(firstSeenAt, now) });
      })
      .filter((bus) => isLiveFresh(bus, now))
      .map((bus) => withAnchorRow(bus, toHeldAnchorRow(bus, this.buses, now)));
    await this.cache.write("hssc", this.buses);
    await this.recordFeedEvents(items, now);
  }

  // WHY: every row, stale ones included, since the log is a timeline of stop events; a key is forgotten only once
  // its write succeeded, and the unique index stores an event a restarted poller sends again once.
  private async recordFeedEvents(items: HsscApiBus[], polledAt: Date): Promise<void> {
    this.reportFeedFormat(items);
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

  // WHY: a feed whose every row stops parsing has changed its format, and the log would stay empty without a sign;
  // logged on the change only, and a tick with no row changes nothing.
  private reportFeedFormat(items: HsscApiBus[]): void {
    const [sample] = items;
    if (!sample) return;
    const isUnparsed = isUnparsedFeed(items);
    if (isUnparsed === this.isFeedUnparsed) return;
    this.isFeedUnparsed = isUnparsed;
    if (isUnparsed) {
      logger.warn(
        { event: "bus.hssc.feed_events_unparsed", seq: sample.seq, rawGetDate: sample.get_date },
        "HSSC feed rows no longer parse: no feed event is logged",
      );
    } else {
      logger.info({ event: "bus.hssc.feed_events_parsed" }, "HSSC feed rows parse again");
    }
  }

  // WHY: never the poller's own memory, so combined answers as an api replica does (ADR 0012, D1); the deprecated
  // realtime route keeps its 3-minute layover window, which the poller judged before the live route (ADR 0019, D8).
  async listBuses(): Promise<HsscBusDoc[]> {
    const now = this.clock.now();
    return ((await this.cache.read("hssc")) ?? []).filter((bus) => isFresh(bus, now));
  }

  // WHY: the live route anchors each cached bus on its latest event and tells a stopped poller by its write instant;
  // a row whose dates no longer parse is left out, as the poller already warns of it (bus.hssc.feed_events_unparsed).
  async findStopEvents(): Promise<HsscStopEvents> {
    const entry = await this.cache.readEntry("hssc");
    const events = (entry?.value ?? []).map(toHsscStopEvent).filter((event): event is HsscStopEvent => event !== null);
    return { events, checkedAt: entry?.updatedAt ?? null };
  }
}
