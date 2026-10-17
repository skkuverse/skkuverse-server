import type { JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { JongroStationMapping } from "../../registry/bus-registry.types";
import type { JongroBusDwell, JongroBusSighting } from "./bus-realtime-jongro.types";

type MappedStation = JongroStationMapping[string];

export function toJongroBusPosition(
  sighting: JongroBusSighting,
  station: MappedStation,
  { firstSeenAt, dwellSeconds }: JongroBusDwell,
): JongroBusPositionDoc {
  return {
    sequence: station.sequence.toString(),
    stationName: station.stationName,
    carNumber: sighting.carNumber,
    eventDate: firstSeenAt,
    estimatedTime: dwellSeconds,
    stationId: sighting.stationId,
    latitude: sighting.latitude,
    longitude: sighting.longitude,
    recordTime: firstSeenAt,
  };
}
