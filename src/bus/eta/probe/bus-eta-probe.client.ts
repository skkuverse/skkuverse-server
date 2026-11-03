import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../../infra/config";
import logger from "../../../infra/logger";
import { UpstreamError } from "../../../infra/upstream.error";
import { DailyCap } from "../../../shared/daily-cap.util";
import { isRecord } from "../../../shared/object.util";
import { parseEach } from "../../../shared/zod-list.util";
import { SEOUL_BUS_API_URL } from "../../bus.constants";
import { toTopisAnswer } from "../../bus.mapper";
import { toTopisFailure, toTopisFailureMessage } from "../../bus.rules";
import { isRetryable } from "./bus-eta-probe.rules";
import { topisPosition, topisPositionList } from "./bus-eta-probe.schema";
import type { LanePosition } from "./bus-eta-probe.types";

const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 3_000;
const MAX_ATTEMPTS = 2;
// QUIRK(topis): "0" is data and "4" no result; any other header code is a refusal (a bad key, a bad route).
const DATA_HEADER_CD = "0";
const NO_RESULT_HEADER_CD = "4";

@Injectable()
export class BusEtaProbeClient {
  private readonly cap = new DailyCap("topis", config.shuttleEta.topisDailyCap);

  // QUIRK(topis): `getBusPosByRtidList` on data.go.kr. The key is stored URL-encoded and goes into the URL as it is:
  // axios `params` would encode it again.
  async fetchPositions(routeId: string, now: Date, opts: { retryDelayMs?: number } = {}): Promise<LanePosition[]> {
    this.cap.take(now);
    const url = `${SEOUL_BUS_API_URL}/buspos/getBusPosByRtid?serviceKey=${config.api.seoulBusServiceKey}&busRouteId=${routeId}&resultType=json`;
    const body = await this.fetchBody(url, `getBusPosByRtid ${routeId}`, opts.retryDelayMs ?? RETRY_DELAY_MS);
    return this.toPositions(routeId, body);
  }

  // WHY: asked once more, 3 s later, after a failure TOPIS may be over by then (isRetryable); the rejection carries
  // what failed, never the axios error, whose URL holds the key.
  private async fetchBody(url: string, what: string, retryDelayMs: number): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      const answer = await axios.get<unknown>(url, { timeout: TIMEOUT_MS }).then(({ data }) => ({ body: data }), toTopisAnswer);
      const failure = toTopisFailure(answer);
      if (failure === null) return answer.body;
      if (attempt === MAX_ATTEMPTS || !isRetryable(failure)) throw new UpstreamError(toTopisFailureMessage(failure, what), "topis", { failure });
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  private toPositions(routeId: string, body: unknown): LanePosition[] {
    const what = `getBusPosByRtid ${routeId}`;
    const answer = topisPositionList.safeParse(body);
    if (!answer.success) throw new UpstreamError(`TOPIS answer is not a bus position answer (${what})`, "topis", { failure: { kind: "shape", detail: "not a bus position answer" } });
    const { headerCd, headerMsg } = answer.data.msgHeader;
    if (headerCd === NO_RESULT_HEADER_CD) return [];
    if (headerCd !== DATA_HEADER_CD) throw new UpstreamError(`TOPIS error code (${what})`, "topis", { headerCd, headerMsg: headerMsg ?? undefined });
    const itemList = answer.data.msgBody?.itemList ?? [];
    const buses = Array.isArray(itemList) ? itemList : [itemList];
    const { valid, invalid } = parseEach(buses, topisPosition, (bus, index) => (isRecord(bus) && typeof bus.vehId === "string" ? bus.vehId : `#${index}`));
    if (invalid.length > 0) logger.warn({ event: "bus.lane.positions_dropped", routeId, invalid }, "TOPIS bus positions left out");
    return valid.map(({ vehId, gpsX, gpsY, sectOrd, dataTm }) => ({ vehId, lat: gpsY, lng: gpsX, sectOrd, dataTm }));
  }
}
