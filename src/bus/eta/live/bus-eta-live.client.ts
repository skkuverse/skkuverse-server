import { Injectable } from "@nestjs/common";
import axios from "axios";
import { withOneRetry } from "../../../infra/directions-retry";
import type { LatLng } from "../../../shared/lat-lng.types";
import { toNaverOffsets } from "./bus-eta-live.rules";
import type { NaverCredentials, NaverDirectionsResponse } from "./bus-eta-live.types";

const ENDPOINT = "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;

@Injectable()
export class BusEtaLiveClient {
  // QUIRK(naver): one Directions 5 call for a whole sequence, as start, waypoints and goal; the keys travel in
  // headers only. Retries once, 3 s later, on a timeout, a reset or a 5xx.
  async fetchOffsets(stops: readonly LatLng[], credentials: NaverCredentials, opts: { retryDelayMs?: number } = {}): Promise<number[]> {
    const [first] = stops;
    const last = stops.at(-1);
    if (!first || !last) throw new Error("a sequence needs a first and a last stop");
    const params: Record<string, string> = {
      start: this.lngLat(first),
      goal: this.lngLat(last),
      option: "traoptimal",
    };
    if (stops.length > 2) params.waypoints = stops.slice(1, -1).map((stop) => this.lngLat(stop)).join("|");
    const res = await withOneRetry(
      "naver",
      () =>
        axios.get<NaverDirectionsResponse>(ENDPOINT, {
          params,
          headers: { "X-NCP-APIGW-API-KEY-ID": credentials.keyId, "X-NCP-APIGW-API-KEY": credentials.key },
          timeout: TIMEOUT_MS,
        }),
      opts.retryDelayMs ?? RETRY_DELAY_MS,
    );
    return toNaverOffsets(res.data, stops);
  }

  private lngLat(stop: LatLng): string {
    return `${stop.lng},${stop.lat}`;
  }
}
