import { Injectable } from "@nestjs/common";
import axios from "axios";
import moment from "moment-timezone";
import type { LatLng } from "../../../shared/lat-lng.types";
import { BusEtaClient } from "../bus-eta.client";
import { KST_TIME_ZONE } from "../../../shared/time-zone.constants";
import { toTmapOffsets } from "./bus-eta-forecast.rules";
import type { TmapCall, TmapPredictionResponse } from "./bus-eta-forecast.types";

const ENDPOINT = "https://apis.openapi.sk.com/tmap/routes/prediction";
const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;

@Injectable()
export class BusEtaForecastClient extends BusEtaClient {
  // QUIRK(tmap): the time-machine forecast for a whole sequence leaving at `departAt` ("arrival" forecasts forward
  // from the departure); the app key travels in a header only. Retries once, 3 s later, on a timeout, a reset or a 5xx.
  async fetchOffsets(stops: readonly LatLng[], departAt: Date, { appKey, retryDelayMs = RETRY_DELAY_MS }: TmapCall): Promise<number[]> {
    const [first] = stops;
    const last = stops.at(-1);
    if (!first || !last) throw new Error("a sequence needs a first and a last stop");
    const routesInfo: Record<string, unknown> = {
      departure: this.place("stop0", first),
      destination: this.place(`stop${stops.length - 1}`, last),
      predictionType: "arrival",
      predictionTime: moment(departAt).tz(KST_TIME_ZONE).format("YYYY-MM-DDTHH:mm:ssZZ"),
      searchOption: "00",
      trafficInfo: "N",
    };
    if (stops.length > 2) {
      routesInfo.wayPoints = { wayPoint: stops.slice(1, -1).map((stop) => ({ lon: String(stop.lng), lat: String(stop.lat) })) };
    }
    const res = await this.fetchWithOneRetry(
      "tmap",
      () =>
        axios.post<TmapPredictionResponse>(
          ENDPOINT,
          { routesInfo },
          {
            params: { version: 1, reqCoordType: "WGS84GEO", resCoordType: "WGS84GEO", sort: "index", totalValue: 1 },
            headers: { appKey, Accept: "application/json", "Content-Type": "application/json" },
            timeout: TIMEOUT_MS,
          },
        ),
      retryDelayMs,
    );
    return toTmapOffsets(res.data, stops);
  }

  private place(name: string, stop: LatLng): { name: string; lon: string; lat: string } {
    return { name, lon: String(stop.lng), lat: String(stop.lat) };
  }
}
