import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import type { HsscBusDoc } from "../../cache/bus-cache.document";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import { toHsscBus } from "./bus-realtime-hssc.mapper";
import { isFresh, toDwellSeconds, toFirstSeenAt, toLinearSequence } from "./bus-realtime-hssc.rules";

@Injectable()
export class BusRealtimeHsscService {
  private buses: HsscBusDoc[] = [];

  constructor(
    private readonly client: BusRealtimeHsscClient,
    private readonly cache: BusCacheService,
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
  }

  // WHY: never the poller's own memory, so combined answers as an api replica does (ADR 0012, D1).
  async listBuses(): Promise<HsscBusDoc[]> {
    return (await this.cache.read("hssc")) ?? [];
  }
}
