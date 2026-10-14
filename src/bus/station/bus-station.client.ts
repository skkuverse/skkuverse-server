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
  // keeps the last message (null); any other code is an error, an expired or throttled key for one.
  async fetchArrivalMessages(): Promise<string[] | null> {
    const response = await axios.get<TopisStationEnvelope>(config.api.stationHyehwa, { timeout: REQUEST_TIMEOUT_MS });
    const header = response.data?.msgHeader;
    if (header?.headerCd === "4") return null;
    if (header?.headerCd && header.headerCd !== "0") {
      throw new UpstreamError("TOPIS error code", "station", header.headerCd, header.headerMsg);
    }
    const rows = response.data?.msgBody?.itemList;
    if (!rows) throw new UpstreamError("Station response has no itemList", "station");
    return rows.map((row) => row.arrmsg1);
  }
}
