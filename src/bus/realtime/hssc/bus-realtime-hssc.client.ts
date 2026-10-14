import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../../infra/config";
import { UpstreamError } from "../../../infra/upstream.error";
import type { HsscApiBus } from "../../cache/bus-cache.document";

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class BusRealtimeHsscClient {
  // QUIRK(hssc): a bare JSON array, no envelope; an empty one means no bus is running.
  async fetchBuses(): Promise<HsscApiBus[]> {
    const response = await axios.get<unknown>(config.api.hsscNew, { timeout: REQUEST_TIMEOUT_MS });
    const body = response.data;
    if (!Array.isArray(body)) throw new UpstreamError(`HSSC response is not an array (${typeof body})`, "hssc");
    return body as HsscApiBus[];
  }
}
