/**
 * Scripted BusRealtimeJongroClient: every route answers the arrivals and
 * sightings set by the test (empty, TOPIS's "no result", until set), or
 * rejects with `failWith`.
 */
import type { JongroArrivalDoc } from "../../../../src/bus/cache/bus-cache.document";
import type { JongroRoute } from "../../../../src/bus/bus.types";
import type { BusRealtimeJongroClient } from "../../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import type { JongroBusSighting } from "../../../../src/bus/realtime/jongro/bus-realtime-jongro.types";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeJongroClient implements PublicOf<BusRealtimeJongroClient> {
  arrivals: JongroArrivalDoc[] = [];
  sightings: JongroBusSighting[] = [];
  failWith: Error | null = null;

  async fetchArrivals(_route: JongroRoute): Promise<JongroArrivalDoc[]> {
    this.fail();
    return this.arrivals;
  }

  async fetchSightings(_route: JongroRoute): Promise<JongroBusSighting[]> {
    this.fail();
    return this.sightings;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
