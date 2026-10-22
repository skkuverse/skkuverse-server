/**
 * A builder for the sighting the Jongro client reads from a getBusPosByRtid
 * row (src/bus/realtime/jongro/bus-realtime-jongro.types.ts), so a test
 * states only the fields it checks. The default is 종로07's 서울74사5537 at
 * 명륜새마을금고 (ord 6), running mid-section.
 */
import type { JongroBusSighting } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.types";

export function jongroSighting(extra: Partial<JongroBusSighting> = {}): JongroBusSighting {
  return {
    stationId: "100900197",
    latitude: "37.587",
    longitude: "126.998",
    carNumber: "5537",
    plainNo: "서울74사5537",
    turnaroundStationId: "100900028",
    vehicleId: "100000103",
    sectOrd: 6,
    sectDist: 0.15,
    fullSectDist: 0.3,
    isAtStop: false,
    observedAt: "2026-10-20T10:00:00+09:00",
    ...extra,
  };
}
