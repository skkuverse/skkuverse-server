import { Injectable } from "@nestjs/common";
import axios from "axios";
import config from "../../../infra/config";
import { createLogThrottle } from "../../../shared/log-throttle.util";
import logger from "../../../infra/logger";
import { UpstreamError } from "../../../infra/upstream.error";
import type { JongroArrivalBus, JongroArrivalDoc } from "../../cache/bus-cache.document";
import type { JongroRoute } from "../../bus.types";
import { toCarNumber } from "../bus-realtime.mapper";
import { toJongroArrivalsUrl, toJongroPositionsUrl } from "./bus-realtime-jongro.mapper";
import { isNoResultHeaderCd, isQuotaExceeded, isUsableHeaderCd, toBusType, toObservedAt, toServiceHours, toTopisDecimal, toTopisInteger } from "./bus-realtime-jongro.rules";
import type { JongroBusSighting } from "./bus-realtime-jongro.types";

const REQUEST_TIMEOUT_MS = 10_000;
// WHY: a spent quota refuses every tick until it resets; a line a minute per operation still feeds the 10-minute alert.
const QUOTA_LOG_INTERVAL_MS = 60_000;

// QUIRK(topis): the envelope both endpoints answer with; itemList is null on "4" (no result).
interface TopisEnvelope<TRow> {
  msgHeader?: { headerCd?: string; headerMsg?: string };
  msgBody?: { itemList?: TRow[] | null };
}

type BusSlot = "1" | "2";
type TopisBusField = "vehId" | "plainNo" | "sectOrd" | "traTime" | "isLast" | "rerdie_Div" | "reride_Num" | "arrmsg" | "busType";

// QUIRK(topis): each row names its first and second bus in fields suffixed 1 and 2, every value a string.
type TopisArrivalRow = { [K in `${TopisBusField}${BusSlot}`]: string } & {
  stId: string;
  staOrd: string;
  stNm: string;
  mkTm: string;
  arsId: string;
} & Partial<Record<"term" | "firstTm" | "lastTm", string>>;

const BUS_SLOTS: readonly BusSlot[] = ["1", "2"];

type TrackedPositionField = "vehId" | "sectOrd" | "sectDist" | "fullSectDist" | "dataTm";

// QUIRK(topis): the data.go.kr operations whose daily quotas these calls spend (docs/project-docs.md, "Daily Usage and Quota Check").
type TopisOperation = "getArrInfoByRouteAllList" | "getBusPosByRtidList";
interface TopisCall { url: string; what: string; operation: TopisOperation; code: string }

// QUIRK(topis): a getBusPosByRtid row; its coordinates are gpsX/gpsY (tmX/tmY come null), its turnaround stop
// trnstnid, sectDist and fullSectDist km, stopFlag "1" at a stop, dataTm a KST yyyyMMddHHmmss, lastStTm seconds.
interface TopisPositionRow {
  lastStnId: string | null;
  trnstnid?: string | null;
  gpsX: string | null;
  gpsY: string | null;
  plainNo: string;
  vehId: string | null;
  sectOrd: string | null;
  sectDist: string | null;
  fullSectDist: string | null;
  stopFlag: string | null;
  dataTm: string | null;
  lastStTm?: string | null;
  busType?: string | null;
}

@Injectable()
export class BusRealtimeJongroClient {
  private readonly quotaThrottle = createLogThrottle(QUOTA_LOG_INTERVAL_MS);

  async fetchArrivals(route: Pick<JongroRoute, "code" | "busRouteId">): Promise<JongroArrivalDoc[]> {
    const what = `jongro ${route.code} list`;
    const url = toJongroArrivalsUrl(route.busRouteId, config.api.seoulBusServiceKey);
    const rows = await this.fetchRows<TopisArrivalRow>({ url, what, operation: "getArrInfoByRouteAllList", code: route.code });
    return rows.map((row) => this.toArrivalDoc(row, what));
  }

  async fetchSightings(route: Pick<JongroRoute, "code" | "busRouteId">): Promise<JongroBusSighting[]> {
    const what = `jongro ${route.code} location`;
    const url = toJongroPositionsUrl(route.busRouteId, config.api.seoulBusServiceKey);
    const rows = await this.fetchRows<TopisPositionRow>({ url, what, operation: "getBusPosByRtidList", code: route.code });
    return rows.map((row) => this.toSighting(row, what));
  }

  // WHY: "4" (no result) is an empty list, so the tick still writes; an answer with no list at all rejects.
  private async fetchRows<TRow>(call: TopisCall): Promise<TRow[]> {
    const body = await this.fetchBody<TRow>(call);
    const headerCd = body?.msgHeader?.headerCd;
    if (!isUsableHeaderCd(headerCd)) {
      throw new UpstreamError(`TOPIS error code (${call.what})`, "topis", headerCd, body.msgHeader?.headerMsg);
    }
    if (isNoResultHeaderCd(headerCd)) return [];
    const rows = body?.msgBody?.itemList;
    if (!Array.isArray(rows)) throw new UpstreamError(`TOPIS response has no itemList (${call.what})`, "topis", headerCd);
    return rows;
  }

  // WHY: the gateway may refuse a spent quota with an HTTP error, whose body still says so; the request rejects either way.
  private async fetchBody<TRow>(call: TopisCall): Promise<TopisEnvelope<TRow>> {
    let body: TopisEnvelope<TRow>;
    try {
      body = (await axios.get<TopisEnvelope<TRow>>(call.url, { timeout: REQUEST_TIMEOUT_MS })).data;
    } catch (err) {
      if (isQuotaExceeded((err as { response?: { data?: unknown } }).response?.data)) this.logQuotaExceeded(call);
      throw err;
    }
    if (!isQuotaExceeded(body)) return body;
    this.logQuotaExceeded(call);
    throw new UpstreamError(`TOPIS daily quota exceeded (${call.what})`, "topis", "22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR");
  }

  // WHY: a spent quota stops every TOPIS route of the operation until it resets, so it is told apart for its alert.
  private logQuotaExceeded({ operation, code }: TopisCall): void {
    const ticket = this.quotaThrottle.take(operation);
    if (ticket) logger.error({ event: "bus.topis.quota_exceeded", operation, code, suppressed: ticket.suppressed }, "TOPIS refused a call over the key's daily quota");
  }

  private toArrivalDoc(row: TopisArrivalRow, what: string): JongroArrivalDoc {
    return {
      stationId: row.stId,
      sequence: row.staOrd,
      stationName: row.stNm,
      carNumber: toCarNumber(row.plainNo1),
      eventDate: row.mkTm,
      stationNumber: row.arsId,
      eta: row.arrmsg1,
      ...{ buses: BUS_SLOTS.map((slot) => this.toArrivalBus(row, slot, what)), ...toServiceHours(row) },
    };
  }

  private toArrivalBus(row: TopisArrivalRow, slot: BusSlot, what: string): JongroArrivalBus {
    const busType = toBusType(row[`busType${slot}`]);
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
      ...(busType !== null && { busType }),
    };
  }

  // WHY: a bus's position on the route and its time are what the arrival is built from; without them the row
  // is not TOPIS's shape, so the tick rejects instead of serving a made-up number.
  private requireInteger(row: TopisArrivalRow, field: keyof TopisArrivalRow, what: string): number {
    const parsed = toTopisInteger(row[field]);
    if (parsed === null) throw new UpstreamError(`TOPIS row has a non-numeric ${field} (${what})`, "topis");
    return parsed;
  }

  // WHY: the stop places the bus and the coordinates draw it, the vehicle and its place in the section track it;
  // without one the row is not TOPIS's shape, and a made-up value would draw the bus in the wrong place.
  private toSighting(row: TopisPositionRow, what: string): JongroBusSighting {
    const field = (name: "lastStnId" | "gpsX" | "gpsY"): string => {
      const text = row[name]?.trim();
      if (!text) throw new UpstreamError(`TOPIS row has no ${name} (${what})`, "topis");
      return text;
    };
    const parsed = <T>(name: TrackedPositionField, parse: (text: string) => T | null): T => {
      const value = parse(row[name]?.trim() ?? "");
      if (value === null) throw new UpstreamError(`TOPIS row has a malformed ${name} (${what})`, "topis");
      return value;
    };
    const busType = toBusType(row.busType);
    return {
      stationId: field("lastStnId"),
      latitude: field("gpsY"),
      longitude: field("gpsX"),
      carNumber: toCarNumber(row.plainNo),
      plainNo: row.plainNo,
      turnaroundStationId: row.trnstnid?.trim() || undefined,
      vehicleId: parsed("vehId", (text) => text || null),
      sectOrd: parsed("sectOrd", toTopisInteger),
      sectDist: parsed("sectDist", toTopisDecimal),
      fullSectDist: parsed("fullSectDist", toTopisDecimal),
      isAtStop: row.stopFlag?.trim() === "1",
      observedAt: parsed("dataTm", toObservedAt),
      lastStTm: toTopisInteger(row.lastStTm) ?? undefined,
      ...(busType !== null && { busType }),
    };
  }
}
