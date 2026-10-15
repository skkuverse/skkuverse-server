import type { HsscApiBus, HsscBusDoc } from "../../cache/bus-cache.document";
import { HSSC_EVENT_DATE_FORMAT, STATION_NAME_BY_HSSC_NAME } from "./bus-realtime-hssc.constants";
import type { HsscBusTiming } from "./bus-realtime-hssc.types";

export function toHsscBus(item: HsscApiBus, { sequence, eventAt, dwellSeconds }: HsscBusTiming): HsscBusDoc {
  return {
    ...item,
    sequence: sequence.toString(),
    stationName: STATION_NAME_BY_HSSC_NAME.get(item.stop_name) ?? item.stop_name,
    carNumber: "0000",
    eventDate: eventAt.format(HSSC_EVENT_DATE_FORMAT),
    estimatedTime: dwellSeconds,
    isLastBus: false,
    line_no: item.line_no,
    stop_no: item.stop_no,
    get_date: item.get_date,
  };
}
