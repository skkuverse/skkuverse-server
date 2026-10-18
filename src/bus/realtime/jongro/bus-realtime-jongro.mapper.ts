import type { JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { JongroStationMapping } from "../../registry/bus-registry.types";
import type { JongroBusSighting, JongroBusTiming } from "./bus-realtime-jongro.types";

type MappedStation = JongroStationMapping[string];

export function toJongroBusPosition(
  sighting: JongroBusSighting,
  station: MappedStation,
  { firstSeenAt, dwellSeconds, isStationary }: JongroBusTiming,
): JongroBusPositionDoc {
  return {
    sequence: sighting.sectOrd.toString(),
    stationName: station.stationName,
    carNumber: sighting.carNumber,
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
  };
}
