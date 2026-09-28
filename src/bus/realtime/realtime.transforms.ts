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
 *  - buildStationEtas: drops unmapped stations and rows with no eta. (It
 *    matches by TOPIS ord + station ID, no longer by name; see the function.)
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
  sequence?: string; // TOPIS staOrd
  eta?: string;
}

// The slice of a registry route that ETA matching needs.
interface EtaRouteIndex {
  readonly mapping: Readonly<JongroStationMapping>;
  readonly topisIds: ReadonlyArray<string>;
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
// The registry lists stops in TOPIS order, so a row's TOPIS ord (`sequence`)
// is its index, confirmed by the station ID at that ord. The ord matters when
// a loop repeats its terminal: 02 lists 성균관대학교 at ord 1 (departing) and
// ord 27 (arriving), with different ETAs, and an ID lookup would put both on
// ord 1. If TOPIS reorders and the ID at that ord differs, fall back to the ID
// (the poller's drift warning fires then too). Never match by name: TOPIS
// renames stops without notice, and loops pass same-named stops twice.
export function buildStationEtas(
  route: EtaRouteIndex,
  busList: unknown,
): StationEta[] {
  if (!Array.isArray(busList)) return [];
  return (busList as RawBusListItem[])
    .map((bus): StationEta | null => {
      if (!bus.eta) return null;
      const ordIdx = parseInt(bus.sequence ?? "", 10) - 1;
      if (route.topisIds[ordIdx] === bus.stationId) {
        return { stationIndex: ordIdx, eta: bus.eta };
      }
      const station = route.mapping[bus.stationId];
      if (!station) return null;
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
