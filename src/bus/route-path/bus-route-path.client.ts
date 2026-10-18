import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { z } from "zod";
import config from "../../infra/config";
import { UpstreamError } from "../../infra/upstream.error";
import { SEOUL_BUS_API_URL } from "../bus.constants";
import { toFetchedRoutePath } from "./bus-route-path.mapper";
import { topisRouteInfoAnswer, topisRoutePoint, topisRouteStation } from "./bus-route-path.schema";
import type { FetchedRoutePath } from "./bus-route-path.types";

const REQUEST_TIMEOUT_MS = 10_000;

// QUIRK(topis): "0" is data; "4" (no result) is no answer for a route that exists, so it fails like any other code.
const DATA_HEADER_CD = "0";

type RouteInfoOperation = "getRoutePath" | "getStaionByRoute";

@Injectable()
export class BusRoutePathClient {
  async fetchRoutePath(busRouteId: string): Promise<FetchedRoutePath> {
    const [points, stations] = await Promise.all([
      this.fetchRows("getRoutePath", busRouteId, topisRoutePoint),
      this.fetchRows("getStaionByRoute", busRouteId, topisRouteStation),
    ]);
    return toFetchedRoutePath(points, stations);
  }

  // QUIRK(topis): the key is stored URL-encoded and goes into the URL as it is: axios `params` would encode it again.
  private async fetchRows<TRow extends z.ZodType>(operation: RouteInfoOperation, busRouteId: string, row: TRow): Promise<Array<z.output<TRow>>> {
    const what = `${operation} ${busRouteId}`;
    const url = `${SEOUL_BUS_API_URL}/busRouteInfo/${operation}?serviceKey=${config.api.seoulBusServiceKey}&busRouteId=${busRouteId}&resultType=json`;
    const answer = topisRouteInfoAnswer.safeParse(await this.fetchBody(url, what));
    if (!answer.success) throw new UpstreamError(`TOPIS answer is not a route info list (${what})`, "topis");
    const { headerCd, headerMsg } = answer.data.msgHeader;
    if (headerCd !== DATA_HEADER_CD) throw new UpstreamError(`TOPIS error code (${what})`, "topis", headerCd, headerMsg ?? undefined);
    const rows = answer.data.msgBody?.itemList ?? [];
    if (rows.length === 0) throw new UpstreamError(`TOPIS answer has no rows (${what})`, "topis", headerCd);
    return rows.map((raw, index) => {
      const parsed = row.safeParse(raw);
      if (!parsed.success) throw new UpstreamError(`TOPIS row ${index} is malformed (${what})`, "topis", headerCd);
      return parsed.data;
    });
  }

  // WHY: an axios error carries the request URL, and so the key, wherever it is serialized; this one carries the status.
  private async fetchBody(url: string, what: string): Promise<unknown> {
    try {
      return (await axios.get<unknown>(url, { timeout: REQUEST_TIMEOUT_MS })).data;
    } catch (err) {
      const status = axios.isAxiosError(err) ? (err.response?.status ?? err.code ?? "no response") : "no response";
      throw new UpstreamError(`TOPIS request failed (${what}, ${status})`, "topis");
    }
  }
}
