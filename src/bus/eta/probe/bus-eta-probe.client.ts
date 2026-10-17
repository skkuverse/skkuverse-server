import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { DailyCap } from "../../../shared/daily-cap.util";
import { isRecord } from "../../../shared/object.util";
import { parseEach } from "../../../shared/zod-list.util";
import { SEOUL_BUS_API_URL } from "../../bus.constants";
import { BusEtaClient } from "../bus-eta.client";
import { BusEtaDirectionsError } from "../bus-eta.error";
import { topisPosition, topisPositionList } from "./bus-eta-probe.schema";
import type { LanePosition } from "./bus-eta-probe.types";

const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;
// QUIRK(topis): "0" is data and "4" no result; any other header code is a refusal (a bad key, a bad route).
const DATA_HEADER_CD = "0";
const NO_RESULT_HEADER_CD = "4";

@Injectable()
export class BusEtaProbeClient extends BusEtaClient {
  private readonly cap = new DailyCap("topis", config.shuttleEta.topisDailyCap);

  // QUIRK(topis): `getBusPosByRtidList` on data.go.kr. The key is stored URL-encoded and goes into the URL as it is:
  // axios `params` would encode it again. Retries once, 3 s later, on a timeout, a reset or a 5xx.
  async fetchPositions(routeId: string, now: Date, opts: { retryDelayMs?: number } = {}): Promise<LanePosition[]> {
    this.cap.take(now);
    const url = `${SEOUL_BUS_API_URL}/buspos/getBusPosByRtid?serviceKey=${config.api.seoulBusServiceKey}&busRouteId=${routeId}&resultType=json`;
    const res = await this.fetchWithOneRetry("topis", () => axios.get<unknown>(url, { timeout: TIMEOUT_MS }), opts.retryDelayMs ?? RETRY_DELAY_MS);
    return this.toPositions(routeId, res.data);
  }

  private toPositions(routeId: string, body: unknown): LanePosition[] {
    const answer = topisPositionList.safeParse(body);
    if (!answer.success) throw new BusEtaDirectionsError("topis", "api", `route ${routeId}: not a bus position answer`);
    const { headerCd } = answer.data.msgHeader;
    if (headerCd === NO_RESULT_HEADER_CD) return [];
    if (headerCd !== DATA_HEADER_CD) throw new BusEtaDirectionsError("topis", "api", `route ${routeId}: header code ${headerCd}`);
    const itemList = answer.data.msgBody?.itemList ?? [];
    const buses = Array.isArray(itemList) ? itemList : [itemList];
    const { valid, invalid } = parseEach(buses, topisPosition, (bus, index) => (isRecord(bus) && typeof bus.vehId === "string" ? bus.vehId : `#${index}`));
    if (invalid.length > 0) logger.warn({ event: "bus.lane.positions_dropped", routeId, invalid }, "TOPIS bus positions left out");
    return valid.map(({ vehId, gpsX, gpsY, sectOrd, dataTm }) => ({ vehId, lat: gpsY, lng: gpsX, sectOrd, dataTm }));
  }
}
