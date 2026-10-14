import { Injectable } from "@nestjs/common";
import axios from "axios";
import { UpstreamError } from "../../../infra/upstream.error";
import type { JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";
import { toCarNumber } from "./bus-realtime-jongro.mapper";
import { isUsableHeaderCd } from "./bus-realtime-jongro.rules";
import type { JongroBusSighting } from "./bus-realtime-jongro.types";

const REQUEST_TIMEOUT_MS = 10_000;

// QUIRK(topis): the envelope both endpoints answer with; itemList is null on "4" (no result).
interface TopisEnvelope<TRow> {
  msgHeader?: { headerCd?: string; headerMsg?: string };
  msgBody?: { itemList?: TRow[] | null };
}

interface TopisArrivalRow {
  stId: string;
  staOrd: string;
  stNm: string;
  plainNo1: string;
  mkTm: string;
  arsId: string;
  arrmsg1: string;
}

interface TopisPositionRow {
  lastStnId: string;
  tmX: string;
  tmY: string;
  plainNo: string;
}

@Injectable()
export class BusRealtimeJongroClient {
  // WHY: null when TOPIS lists nothing (overnight or no envelope), which keeps the last arrivals.
  async fetchArrivals(route: JongroRoute): Promise<JongroArrivalDoc[] | null> {
    const rows = await this.fetchRows<TopisArrivalRow>(route.arrivalsUrl, `jongro ${route.code} list`);
    return rows?.map((row) => this.toArrival(row)) ?? null;
  }

  async fetchSightings(route: JongroRoute): Promise<JongroBusSighting[] | null> {
    const rows = await this.fetchRows<TopisPositionRow>(route.positionsUrl, `jongro ${route.code} location`);
    return rows?.map((row) => this.toSighting(row)) ?? null;
  }

  private async fetchRows<TRow>(url: string, what: string): Promise<TRow[] | null> {
    const response = await axios.get<TopisEnvelope<TRow>>(url, { timeout: REQUEST_TIMEOUT_MS });
    const body = response.data;
    const headerCd = body?.msgHeader?.headerCd;
    if (!isUsableHeaderCd(headerCd)) {
      throw new UpstreamError(`TOPIS error code (${what})`, "topis", headerCd, body.msgHeader?.headerMsg);
    }
    return body?.msgBody?.itemList || null;
  }

  private toArrival(row: TopisArrivalRow): JongroArrivalDoc {
    return {
      stationId: row.stId,
      sequence: row.staOrd,
      stationName: row.stNm,
      carNumber: toCarNumber(row.plainNo1),
      eventDate: row.mkTm,
      stationNumber: row.arsId,
      eta: row.arrmsg1,
    };
  }

  private toSighting(row: TopisPositionRow): JongroBusSighting {
    return { stationId: row.lastStnId, latitude: row.tmY, longitude: row.tmX, carNumber: toCarNumber(row.plainNo) };
  }
}
