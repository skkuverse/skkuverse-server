import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import type { HsscBusDoc } from "../../cache/bus-cache.document";
import { BusCacheService } from "../../cache/bus-cache.service";
import { BusRealtimeHsscClient } from "./bus-realtime-hssc.client";
import { toHsscBus } from "./bus-realtime-hssc.mapper";
import { isFresh, toDwellSeconds, toEventAt, toLinearSequence } from "./bus-realtime-hssc.rules";

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
        const eventAt = toEventAt(item, this.buses);
        const sequence = toLinearSequence(parseInt(item.seq, 10));
        return toHsscBus(item, { sequence, eventAt, dwellSeconds: toDwellSeconds(eventAt, now) });
      })
      .filter((bus) => isFresh(bus, now));
    await this.cache.write("hssc", this.buses);
  }

  // WHY: an api replica runs no poller, so its memory stays empty and only bus_cache has buses.
  async listBuses(): Promise<HsscBusDoc[]> {
    return (await this.cache.read("hssc")) ?? this.buses;
  }
}
