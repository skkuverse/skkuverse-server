import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../../infra/config";
import { createLogThrottle } from "../../../shared/log-throttle.util";
import logger from "../../../infra/logger";
import { UpstreamError } from "../../../infra/upstream.error";
import type { JongroRoute } from "../../bus.types";
import type { VehicleSeats } from "./bus-realtime-gbis.document";
import { isNoResult, isQuotaExceeded, toGatewayRefusal, toSeatsLeft } from "./bus-realtime-gbis.rules";
import { gbisLocationAnswer, type GbisBusLocation } from "./bus-realtime-gbis.schema";
import type { GatewayRefusal } from "./bus-realtime-gbis.types";

const LOCATION_URL = "https://apis.data.go.kr/6410000/buslocationservice/v2/getBusLocationListv2";
const OPERATION = "getBusLocationListv2";
const UPSTREAM = "gbis";
const REQUEST_TIMEOUT_MS = 10_000;
const SUCCESS_RESULT_CODE = 0;
const QUOTA_REASON_CODE = "22";
// WHY: a spent quota refuses every tick until it resets; a line a minute still feeds the 10-minute alert.
const QUOTA_LOG_INTERVAL_MS = 60_000;

type SeatRoute = Pick<JongroRoute, "code" | "busRouteId">;

@Injectable()
export class BusRealtimeGbisClient {
  private readonly quotaThrottle = createLogThrottle(QUOTA_LOG_INTERVAL_MS);

  // QUIRK(gbis): a Gyeonggi route's TOPIS busRouteId is its GBIS routeId (7800: 200000150).
  async fetchSeats(route: SeatRoute): Promise<VehicleSeats[]> {
    const body = await this.fetchBody(route);
    if (isQuotaExceeded(body)) throw this.toQuotaError(route);
    const refusal = toGatewayRefusal(body);
    if (refusal) throw this.toRefusalError(route, refusal);
    const answer = gbisLocationAnswer.safeParse(body);
    if (!answer.success) throw new UpstreamError(`GBIS ${route.code} seats: the answer is not in its shape`, UPSTREAM);
    const { msgHeader, msgBody } = answer.data.response;
    if (isNoResult(msgHeader.resultCode)) return [];
    if (msgHeader.resultCode !== SUCCESS_RESULT_CODE || !msgBody) {
      throw new UpstreamError(`GBIS ${route.code} seats: result code ${msgHeader.resultCode}`, UPSTREAM, String(msgHeader.resultCode), msgHeader.resultMessage ?? undefined);
    }
    return [msgBody.busLocationList].flat().map((bus) => this.toVehicleSeats(bus));
  }

  // QUIRK(gbis): data.go.kr takes the service key in the query string, so a failure keeps only its status or code.
  private async fetchBody(route: SeatRoute): Promise<unknown> {
    try {
      const { data } = await axios.get<unknown>(LOCATION_URL, {
        params: { serviceKey: config.gbis.serviceKey, routeId: route.busRouteId, format: "json" },
        timeout: REQUEST_TIMEOUT_MS,
      });
      return data;
    } catch (err: unknown) {
      throw this.toRequestError(route, err);
    }
  }

  private toRequestError(route: SeatRoute, err: unknown): UpstreamError {
    if (!axios.isAxiosError(err)) return new UpstreamError(`GBIS ${route.code} seats: request failed`, UPSTREAM);
    if (isQuotaExceeded(err.response?.data)) return this.toQuotaError(route);
    const refusal = toGatewayRefusal(err.response?.data);
    if (refusal) return this.toRefusalError(route, refusal);
    const status = err.response?.status;
    const detail = status === undefined ? `request failed (${err.code ?? "no code"})` : `HTTP ${status}`;
    return new UpstreamError(`GBIS ${route.code} seats: ${detail}`, UPSTREAM);
  }

  private toRefusalError({ code }: SeatRoute, refusal: GatewayRefusal): UpstreamError {
    return new UpstreamError(`GBIS ${code} seats: gateway refused, ${refusal.message} (${refusal.code})`, UPSTREAM, refusal.code, refusal.message);
  }

  // WHY: a spent quota loses every route's seats until it resets, so it is told apart for its alert.
  private toQuotaError({ code }: SeatRoute): UpstreamError {
    const ticket = this.quotaThrottle.take(OPERATION);
    if (ticket) logger.warn({ event: "bus.gbis.quota_exceeded", operation: OPERATION, code, suppressed: ticket.suppressed }, "GBIS refused a call over the key's daily quota");
    return new UpstreamError(`GBIS daily quota exceeded (${code} seats)`, UPSTREAM, QUOTA_REASON_CODE, "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR");
  }

  private toVehicleSeats(bus: GbisBusLocation): VehicleSeats {
    return { vehicleId: String(bus.vehId), seatsLeft: toSeatsLeft(bus.remainSeatCnt) };
  }
}
