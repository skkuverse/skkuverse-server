/**
 * Scripted BusEtaTravelClient: `fetchOffsets` answers `offsetsSec`, and
 * `fetchRouteTimes` answers `routeTimes`, or each rejects with its `failWith`.
 * `calls` records every request with the points and keys it was sent.
 */
import type { BusEtaTravelClient } from "../../../../src/bus/eta/travel/bus-eta-travel.client";
import type { NaverCredentials, RoutePoint, RouteTimes } from "../../../../src/bus/eta/travel/bus-eta-travel.types";
import type { LatLng } from "../../../../src/shared/lat-lng.types";
import type { PublicOf } from "../public-of";

export class FakeBusEtaTravelClient implements PublicOf<BusEtaTravelClient> {
  offsetsSec: number[] = [0, 4500];
  routeTimes: RouteTimes = { stopOffsetsSec: [0, 4200], legsSec: [600, 1800, 1800] };
  calls: Array<{ points: readonly (LatLng | RoutePoint)[]; credentials: NaverCredentials }> = [];
  failWith: Error | null = null;

  async fetchOffsets(stops: readonly LatLng[], credentials: NaverCredentials, _opts?: { retryDelayMs?: number }): Promise<number[]> {
    this.calls.push({ points: stops, credentials });
    if (this.failWith) throw this.failWith;
    return this.offsetsSec;
  }

  async fetchRouteTimes(points: readonly RoutePoint[], credentials: NaverCredentials, _opts?: { retryDelayMs?: number }): Promise<RouteTimes> {
    this.calls.push({ points, credentials });
    if (this.failWith) throw this.failWith;
    return this.routeTimes;
  }
}
