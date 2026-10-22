/**
 * Builders for the documents the bus pollers write to bus_cache, typed by the
 * key map (src/bus/cache/bus-cache.document.ts), so a test seeds a shape the
 * cache can hold and states only the fields it checks. Lives under helpers/ so
 * jest does not collect it as a suite.
 */
import type {
  HsscBusDoc,
  JongroArrivalBus,
  JongroArrivalDoc,
  JongroBusPositionDoc,
} from "../../../src/bus/cache/bus-cache.document";

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
    plainNo: "서울74사5537",
    eventDate: "2026-10-20T01:00:00.000Z",
    estimatedTime: 0,
    stationId: "100900197",
    latitude: "37.587",
    longitude: "126.998",
    recordTime: "2026-10-20T01:00:00.000Z",
    vehicleId: "100000103",
    sectDist: 0.15,
    fullSectDist: 0.3,
    isAtStop: false,
    observedAt: "2026-10-20T10:00:00+09:00",
    isStationary: false,
    ...extra,
  };
}

/** A bus of an arrival row; the default is 종로07's 서울70사5537 two stops before ord 3, 3 minutes away. */
export function jongroArrivalBus(extra: Partial<JongroArrivalBus> = {}): JongroArrivalBus {
  return {
    traTime: 185,
    sectOrd: 1,
    staOrd: 3,
    arrmsg: "3분5초후[2번째 전]",
    isLast: false,
    plainNo: "서울70사5537",
    vehId: "100000103",
    rerideDiv: 2,
    rerideNum: 9,
    ...extra,
  };
}

/** What TOPIS sends for a bus slot it has no bus for. */
export function noArrivalBus(extra: Partial<JongroArrivalBus> = {}): JongroArrivalBus {
  return jongroArrivalBus({ traTime: 0, sectOrd: 0, arrmsg: "", plainNo: " ", vehId: "0", rerideDiv: 0, rerideNum: 0, ...extra });
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
    buses: [jongroArrivalBus({ staOrd: 1, sectOrd: 0, arrmsg: "3분후[2번째 전]" }), noArrivalBus({ staOrd: 1 })],
    ...extra,
  };
}
