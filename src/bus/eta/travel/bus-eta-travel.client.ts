import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { LatLng } from "../../../shared/lat-lng.types";
import { BusEtaClient } from "../bus-eta.client";
import { toNaverOffsets, toNaverRouteTimes } from "./bus-eta-travel.rules";
import type { NaverCredentials, NaverDirectionsResponse, RoutePoint, RouteTimes } from "./bus-eta-travel.types";

const ENDPOINT = "https://maps.apigw.ntruss.com/map-direction/v1/driving";
const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;
const MAX_WAYPOINTS = 5;

@Injectable()
export class BusEtaTravelClient extends BusEtaClient {
  async fetchOffsets(stops: readonly LatLng[], credentials: NaverCredentials, opts: { retryDelayMs?: number } = {}): Promise<number[]> {
    return toNaverOffsets(await this.fetchDirections(stops, credentials, opts), stops);
  }

  // QUIRK(naver): Directions 5 takes at most 5 waypoints, so a longer route is refused before the call.
  async fetchRouteTimes(points: readonly RoutePoint[], credentials: NaverCredentials, opts: { retryDelayMs?: number } = {}): Promise<RouteTimes> {
    if (points.length - 2 > MAX_WAYPOINTS) throw new Error(`a route takes at most ${MAX_WAYPOINTS} points between its ends, got ${points.length - 2}`);
    const res = await this.fetchDirections(points.map((point) => point.at), credentials, opts);
    return toNaverRouteTimes(res, points);
  }

  // QUIRK(naver): one Directions 5 call for a whole route, as start, waypoints and goal; the keys travel in
  // headers only. Retries once, 3 s later, on a timeout, a reset or a 5xx.
  private async fetchDirections(points: readonly LatLng[], credentials: NaverCredentials, opts: { retryDelayMs?: number }): Promise<NaverDirectionsResponse> {
    const [first] = points;
    const last = points.at(-1);
    if (!first || !last) throw new Error("a sequence needs a first and a last stop");
    const params: Record<string, string> = {
      start: this.lngLat(first),
      goal: this.lngLat(last),
      option: "traoptimal",
    };
    if (points.length > 2) params.waypoints = points.slice(1, -1).map((point) => this.lngLat(point)).join("|");
    const res = await this.fetchWithOneRetry(
      "naver",
      () =>
        axios.get<NaverDirectionsResponse>(ENDPOINT, {
          params,
          headers: { "X-NCP-APIGW-API-KEY-ID": credentials.keyId, "X-NCP-APIGW-API-KEY": credentials.key },
          timeout: TIMEOUT_MS,
        }),
      opts.retryDelayMs ?? RETRY_DELAY_MS,
    );
    return res.data;
  }

  private lngLat(point: LatLng): string {
    return `${point.lng},${point.lat}`;
  }
}
