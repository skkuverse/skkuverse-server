import type { HsscAnchorRow, HsscApiBus, HsscBusDoc } from "../../cache/bus-cache.document";
import { HSSC_EVENT_DATE_FORMAT, STATION_NAME_BY_HSSC_NAME } from "./bus-realtime-hssc.constants";
import type { HsscFeedEventDoc } from "./bus-realtime-hssc.document";
import type { HsscBusTiming, HsscFeedEventTiming } from "./bus-realtime-hssc.types";

export function toHsscBus(item: HsscApiBus, { sequence, firstSeenAt, dwellSeconds }: HsscBusTiming): HsscBusDoc {
  return {
    ...item,
    sequence: sequence.toString(),
    stationName: STATION_NAME_BY_HSSC_NAME.get(item.stop_name) ?? item.stop_name,
    carNumber: "0000",
    eventDate: firstSeenAt.format(HSSC_EVENT_DATE_FORMAT),
    estimatedTime: dwellSeconds,
    isLastBus: false,
  };
}

// WHY: no key when the feed's row anchors, so the stored entry keeps the shape the deprecated route pins (ADR 0019, D11).
export function withAnchorRow(bus: HsscBusDoc, anchorRow: HsscAnchorRow | null): HsscBusDoc {
  return anchorRow ? { ...bus, anchorRow } : bus;
}

export function toHsscFeedEventDoc(item: HsscApiBus, { seq, getDate }: HsscFeedEventTiming, polledAt: Date): HsscFeedEventDoc {
  return {
    lineNo: item.line_no,
    seq,
    stopNo: item.stop_no,
    stopName: item.stop_name,
    inout: item.inout,
    getDate,
    rawGetDate: item.get_date,
    polledAt,
  };
}
