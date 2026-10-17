/**
 * Scripted BusRealtimeJongroClient: every route answers the arrivals and
 * sightings set by the test (empty, TOPIS's "no result", until set), or
 * rejects with `failWith`. `positionsUrls` records each position request.
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
  positionsUrls: string[] = [];

  async fetchArrivals(_route: Pick<JongroRoute, "code" | "arrivalsUrl">): Promise<JongroArrivalDoc[]> {
    this.fail();
    return this.arrivals;
  }

  async fetchSightings(route: Pick<JongroRoute, "code" | "positionsUrl">): Promise<JongroBusSighting[]> {
    this.positionsUrls.push(route.positionsUrl);
    this.fail();
    return this.sightings;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
