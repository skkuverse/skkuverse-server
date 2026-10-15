import type { JongroBusPositionDoc } from "../../cache/bus-cache.document";
import type { JongroStationMapping } from "../../bus.types";
import { NO_CAR_NUMBER } from "./bus-realtime-jongro.constants";
import type { JongroBusDwell, JongroBusSighting } from "./bus-realtime-jongro.types";

type MappedStation = JongroStationMapping[string];

// QUIRK(topis): plate numbers may come padded with spaces; the app shows the last four digits.
export function toCarNumber(plateNo: string | undefined): string {
  return (plateNo || "").trim().slice(-4) || NO_CAR_NUMBER;
}

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
