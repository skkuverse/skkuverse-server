import { Injectable } from "@nestjs/common";
import axios from "axios";
import { UpstreamError } from "../../../infra/upstream.error";
import type { JongroArrivalBus, JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";
import { toCarNumber } from "../bus-realtime.mapper";
import { isNoResultHeaderCd, isUsableHeaderCd, toTopisInteger } from "./bus-realtime-jongro.rules";
import type { JongroBusSighting } from "./bus-realtime-jongro.types";

const REQUEST_TIMEOUT_MS = 10_000;

// QUIRK(topis): the envelope both endpoints answer with; itemList is null on "4" (no result).
interface TopisEnvelope<TRow> {
  msgHeader?: { headerCd?: string; headerMsg?: string };
  msgBody?: { itemList?: TRow[] | null };
}

type BusSlot = "1" | "2";
type TopisBusField = "vehId" | "plainNo" | "sectOrd" | "traTime" | "isLast" | "rerdie_Div" | "reride_Num" | "arrmsg";

// QUIRK(topis): each row names its first and second bus in fields suffixed 1 and 2, every value a string.
type TopisArrivalRow = { [K in `${TopisBusField}${BusSlot}`]: string } & {
  stId: string;
  staOrd: string;
  stNm: string;
  mkTm: string;
  arsId: string;
};

const BUS_SLOTS: readonly BusSlot[] = ["1", "2"];

interface TopisPositionRow {
  lastStnId: string;
  tmX: string;
  tmY: string;
  plainNo: string;
}

@Injectable()
export class BusRealtimeJongroClient {
  async fetchArrivals(route: JongroRoute): Promise<JongroArrivalDoc[]> {
    const what = `jongro ${route.code} list`;
    const rows = await this.fetchRows<TopisArrivalRow>(route.arrivalsUrl, what);
    return rows.map((row) => this.toArrival(row, what));
  }

  async fetchSightings(route: JongroRoute): Promise<JongroBusSighting[]> {
    const rows = await this.fetchRows<TopisPositionRow>(route.positionsUrl, `jongro ${route.code} location`);
    return rows.map((row) => this.toSighting(row));
  }

  // WHY: "4" (no result) is an empty list, so the tick still writes; an answer with no list at all rejects.
  private async fetchRows<TRow>(url: string, what: string): Promise<TRow[]> {
    const response = await axios.get<TopisEnvelope<TRow>>(url, { timeout: REQUEST_TIMEOUT_MS });
    const body = response.data;
    const headerCd = body?.msgHeader?.headerCd;
    if (!isUsableHeaderCd(headerCd)) {
      throw new UpstreamError(`TOPIS error code (${what})`, "topis", headerCd, body.msgHeader?.headerMsg);
    }
    if (isNoResultHeaderCd(headerCd)) return [];
    const rows = body?.msgBody?.itemList;
    if (!Array.isArray(rows)) throw new UpstreamError(`TOPIS response has no itemList (${what})`, "topis", headerCd);
    return rows;
  }

  private toArrival(row: TopisArrivalRow, what: string): JongroArrivalDoc {
    return {
      stationId: row.stId,
      sequence: row.staOrd,
      stationName: row.stNm,
      carNumber: toCarNumber(row.plainNo1),
      eventDate: row.mkTm,
      stationNumber: row.arsId,
      eta: row.arrmsg1,
      buses: BUS_SLOTS.map((slot) => this.toArrivalBus(row, slot, what)),
    };
  }

  private toArrivalBus(row: TopisArrivalRow, slot: BusSlot, what: string): JongroArrivalBus {
    return {
      traTime: this.requireInteger(row, `traTime${slot}`, what),
      sectOrd: this.requireInteger(row, `sectOrd${slot}`, what),
      staOrd: this.requireInteger(row, "staOrd", what),
      arrmsg: row[`arrmsg${slot}`],
      isLast: row[`isLast${slot}`] === "1",
      plainNo: row[`plainNo${slot}`],
      vehId: row[`vehId${slot}`],
      rerideDiv: toTopisInteger(row[`rerdie_Div${slot}`]),
      rerideNum: toTopisInteger(row[`reride_Num${slot}`]),
    };
  }

  // WHY: a bus's position on the route and its time are what the arrival is built from; without them the row
  // is not TOPIS's shape, so the tick rejects instead of serving a made-up number.
  private requireInteger(row: TopisArrivalRow, field: keyof TopisArrivalRow, what: string): number {
    const parsed = toTopisInteger(row[field]);
    if (parsed === null) throw new UpstreamError(`TOPIS row has a non-numeric ${field} (${what})`, "topis");
    return parsed;
  }

  private toSighting(row: TopisPositionRow): JongroBusSighting {
    return { stationId: row.lastStnId, latitude: row.tmY, longitude: row.tmX, carNumber: toCarNumber(row.plainNo) };
  }
}
