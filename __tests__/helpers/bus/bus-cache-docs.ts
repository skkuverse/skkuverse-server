/**
 * Builders for the documents the bus pollers write to bus_cache, typed by the
 * key map (src/bus/cache/bus-cache.document.ts), so a test seeds a shape the
 * cache can hold and states only the fields it checks. Lives under helpers/ so
 * jest does not collect it as a suite.
 */
import type { HsscBusDoc, JongroArrivalDoc, JongroBusPositionDoc } from "../../../src/bus/cache/bus-cache.document";

export function hsscBusDoc(extra: Partial<HsscBusDoc> = {}): HsscBusDoc {
  return {
    line_no: "1",
    inout: "LEFT",
    stop_no: "1",
    seq: "6",
    stop_name: "농구장정류소",
    get_date: "2026-10-20 오전 9:59:30",
    sequence: "2",
    stationName: "농구장 (셔틀버스정류소)",
    carNumber: "0000",
    eventDate: "2026-10-20 09:59:30",
    estimatedTime: 30,
    isLastBus: false,
    ...extra,
  };
}

export function jongroPositionDoc(extra: Partial<JongroBusPositionDoc> = {}): JongroBusPositionDoc {
  return {
    sequence: "6",
    stationName: "명륜새마을금고",
    carNumber: "5537",
    eventDate: "2026-10-20T01:00:00.000Z",
    estimatedTime: 0,
    stationId: "100900197",
    latitude: "37.587",
    longitude: "126.998",
    recordTime: "2026-10-20T01:00:00.000Z",
    ...extra,
  };
}

export function jongroArrivalDoc(extra: Partial<JongroArrivalDoc> = {}): JongroArrivalDoc {
  return {
    stationId: "100900220",
    sequence: "1",
    stationName: "성균관대후문",
    carNumber: "5537",
    eventDate: "2026-10-20 10:00:00.0",
    stationNumber: "01000",
    eta: "3분후[2번째 전]",
    ...extra,
  };
}
