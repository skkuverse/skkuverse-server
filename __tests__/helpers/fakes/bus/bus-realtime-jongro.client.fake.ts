/**
 * Scripted BusRealtimeJongroClient: every route answers the arrivals and
 * sightings set by the test (null as TOPIS's "no result"), or rejects with
 * `failWith`.
 */
import type { JongroArrivalDoc } from "../../../../src/bus/cache/bus-cache.document";
import type { JongroRoute } from "../../../../src/bus/bus.types";
import type { BusRealtimeJongroClient } from "../../../../src/bus/realtime/jongro/bus-realtime-jongro.client";
import type { JongroBusSighting } from "../../../../src/bus/realtime/jongro/bus-realtime-jongro.types";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeJongroClient implements PublicOf<BusRealtimeJongroClient> {
  arrivals: JongroArrivalDoc[] | null = null;
  sightings: JongroBusSighting[] | null = null;
  failWith: Error | null = null;

  async fetchArrivals(_route: JongroRoute): Promise<JongroArrivalDoc[] | null> {
    this.fail();
    return this.arrivals;
  }

  async fetchSightings(_route: JongroRoute): Promise<JongroBusSighting[] | null> {
    this.fail();
    return this.sightings;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
