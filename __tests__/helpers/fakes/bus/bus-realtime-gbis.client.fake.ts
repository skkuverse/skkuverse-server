/**
 * Scripted BusRealtimeGbisClient: each fetch answers the seats set by the test, or rejects with `failWith`;
 * `routes` keeps the route each call asked for.
 */
import type { JongroRoute } from "../../../../src/bus/bus.types";
import type { BusRealtimeGbisClient } from "../../../../src/bus/realtime/gbis/bus-realtime-gbis.client";
import type { VehicleSeats } from "../../../../src/bus/realtime/gbis/bus-realtime-gbis.document";
import type { PublicOf } from "../public-of";

export class FakeBusRealtimeGbisClient implements PublicOf<BusRealtimeGbisClient> {
  seats: VehicleSeats[] = [];
  failWith: Error | null = null;
  routes: Array<Pick<JongroRoute, "code" | "busRouteId">> = [];

  async fetchSeats(route: Pick<JongroRoute, "code" | "busRouteId">): Promise<VehicleSeats[]> {
    this.routes.push(route);
    if (this.failWith) throw this.failWith;
    return this.seats;
  }
}
