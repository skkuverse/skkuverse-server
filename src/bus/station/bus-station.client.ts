import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../infra/config";
import { UpstreamError } from "../../infra/upstream.error";

const REQUEST_TIMEOUT_MS = 10_000;

// QUIRK(topis): the arrival envelope for one stop; only each row's first arrival text is read.
interface TopisStationEnvelope {
  msgHeader?: { headerCd?: string; headerMsg?: string };
  msgBody?: { itemList?: Array<{ arrmsg1: string }> | null };
}

@Injectable()
export class BusStationClient {
  // QUIRK(topis): "0" is data and "4" no result, the answer for this stop in every sample so far, which
  // lists no arrival; any other code is an error, an expired or throttled key for one.
  async fetchArrivalMessages(): Promise<string[]> {
    const response = await axios.get<TopisStationEnvelope>(config.api.stationHyehwa, { timeout: REQUEST_TIMEOUT_MS });
    return this.toMessages(response.data ?? {});
  }

  private toMessages({ msgHeader, msgBody }: TopisStationEnvelope): string[] {
    if (msgHeader?.headerCd === "4") return [];
    if (msgHeader?.headerCd && msgHeader.headerCd !== "0") {
      throw new UpstreamError("TOPIS error code", "station", msgHeader.headerCd, msgHeader.headerMsg);
    }
    const rows = msgBody?.itemList;
    if (!rows) throw new UpstreamError("Station response has no itemList", "station");
    return rows.map((row) => row.arrmsg1);
  }
}
