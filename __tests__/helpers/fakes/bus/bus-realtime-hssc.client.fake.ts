/**
 * Scripted BusRealtimeHsscClient: each fetch answers the rows set by the test,
 * or rejects with `failWith`.
 */
import type { HsscApiBus } from "../../../../src/bus/cache/bus-cache.document";
import type { BusRealtimeHsscClient } from "../../../../src/bus/realtime/hssc/bus-realtime-hssc.client";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeHsscClient implements PublicOf<BusRealtimeHsscClient> {
  buses: HsscApiBus[] = [];
  failWith: Error | null = null;

  async fetchBuses(): Promise<HsscApiBus[]> {
    if (this.failWith) throw this.failWith;
    return this.buses;
  }
}
