import type { JongroStationMapping } from "../types";

/**
 * Realtime transform helpers — verbatim port of the private helpers in
 * features/bus/realtime.routes.ts (mapBuses / buildStationEtas /
 * currentTimeString). Exported here so the RealtimeController (next agent) and
 * its tests can import them.
 *
 * CRITICAL parity points preserved exactly:
 *  - mapBuses: `parseInt(b.sequence, 10) - 1` (1-based → 0-based stationIndex)
 *    and the conditional spread `...(b.latitude != null && { latitude })` so
 *    latitude/longitude keys are present ONLY when non-null.
 *  - buildStationEtas: drops unmapped stations and rows with no eta. (It no
 *    longer matches by name; see the function comment.)
 *  - currentTimeString: en-US 12h Asia/Seoul "hh:mm AM/PM".
 */

interface RawBus {
  sequence: string;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

export interface MappedBus {
  stationIndex: number;
  carNumber: string;
  estimatedTime: number;
  latitude?: string;
  longitude?: string;
}

interface RawBusListItem {
  stationId: string;
  eta?: string;
}

export interface StationEta {
  stationIndex: number;
  eta: string;
}

// Maps raw fetcher bus data to client format.
// sequence is 1-based (from fetchers), stationIndex is 0-based.
export function mapBuses(rawBuses: unknown): MappedBus[] {
  if (!Array.isArray(rawBuses)) return [];
  return (rawBuses as RawBus[]).map((b) => ({
    stationIndex: parseInt(b.sequence, 10) - 1,
    carNumber: b.carNumber,
    estimatedTime: b.estimatedTime,
    ...(b.latitude != null && { latitude: b.latitude }),
    ...(b.longitude != null && { longitude: b.longitude }),
  }));
}

// Builds stationEtas from Jongro busList API data.
// Matches by TOPIS station ID (the busList `stationId` is TOPIS `stId`, the same
// key as the registry mapping). Matching by name broke twice: TOPIS renames
// stops without notice, and a loop route passes the same-named stop in both
// directions (07's 성균관대정문, 02's 가회동주민센터), so a name lookup piled
// both ETAs onto the first occurrence.
export function buildStationEtas(
  mapping: Readonly<JongroStationMapping>,
  busList: unknown,
): StationEta[] {
  if (!Array.isArray(busList)) return [];
  return (busList as RawBusListItem[])
    .map((bus): StationEta | null => {
      const station = mapping[bus.stationId];
      if (!station || !bus.eta) return null;
      return { stationIndex: station.sequence - 1, eta: bus.eta };
    })
    .filter((x): x is StationEta => x !== null);
}

export function currentTimeString(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
