import { SEOUL_BUS_API_URL } from "../../bus.constants";
import type { JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { JongroStationMapping } from "../../registry/bus-registry.types";
import type { JongroBusSighting, JongroBusTiming } from "./bus-realtime-jongro.types";

type MappedStation = JongroStationMapping[string];

export function toJongroArrivalsUrl(busRouteId: string, serviceKey: string): string {
  return `${SEOUL_BUS_API_URL}/arrive/getArrInfoByRouteAll?serviceKey=${serviceKey}&busRouteId=${busRouteId}&resultType=json`;
}

// QUIRK(topis): getBusPosByRtid answers the whole route with each row's turnaround stop; getBusPosByRouteSt does not.
export function toJongroPositionsUrl(busRouteId: string, serviceKey: string): string {
  return `${SEOUL_BUS_API_URL}/buspos/getBusPosByRtid?serviceKey=${serviceKey}&busRouteId=${busRouteId}&resultType=json`;
}

export function toJongroBusPosition(
  sighting: JongroBusSighting,
  station: MappedStation,
  { firstSeenAt, dwellSeconds, isStationary, atStopSince }: JongroBusTiming,
): JongroBusPositionDoc {
  return {
    sequence: sighting.sectOrd.toString(),
    stationName: station.stationName,
    carNumber: sighting.carNumber,
    plainNo: sighting.plainNo,
    eventDate: firstSeenAt,
    estimatedTime: dwellSeconds,
    stationId: sighting.stationId,
    latitude: sighting.latitude,
    longitude: sighting.longitude,
    recordTime: firstSeenAt,
    vehicleId: sighting.vehicleId,
    sectDist: sighting.sectDist,
    fullSectDist: sighting.fullSectDist,
    isAtStop: sighting.isAtStop,
    observedAt: sighting.observedAt,
    isStationary,
    ...(atStopSince !== undefined && { atStopSince }),
    ...(sighting.busType !== undefined && { busType: sighting.busType }),
  };
}
