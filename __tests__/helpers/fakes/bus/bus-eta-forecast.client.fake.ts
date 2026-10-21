/**
 * Scripted BusEtaForecastClient: `fetchOffsets` answers `offsetsOf(stops)`
 * when set, else `offsetsSec`, or rejects with `failWith`. `calls` records every request with its stops,
 * departure and app key.
 */
import type { BusEtaForecastClient } from "../../../../src/bus/eta/forecast/bus-eta-forecast.client";
import type { TmapCall } from "../../../../src/bus/eta/forecast/bus-eta-forecast.types";
import type { LatLng } from "../../../../src/shared/lat-lng.types";
import type { PublicOf } from "../public-of";

export class FakeBusEtaForecastClient implements PublicOf<BusEtaForecastClient> {
  offsetsSec: number[] = [0, 5040];
  offsetsOf: ((stops: readonly LatLng[]) => number[]) | null = null;
  calls: Array<{ stops: readonly LatLng[]; departAt: Date; appKey: string }> = [];
  failWith: Error | null = null;

  async fetchOffsets(stops: readonly LatLng[], departAt: Date, { appKey }: TmapCall): Promise<number[]> {
    this.calls.push({ stops, departAt, appKey });
    if (this.failWith) throw this.failWith;
    return this.offsetsOf ? this.offsetsOf(stops) : this.offsetsSec;
  }
}
