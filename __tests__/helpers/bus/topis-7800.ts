/**
 * 7800 as TOPIS answered it on 2026-10-24 17:51 KST (fixtures/topis-7800-arrivals.json, topis-7800-positions.json,
 * topis-route-stations-7800.json), in the shapes the pollers store: the arrival rows and position sightings as
 * BusRealtimeJongroClient reads them (its spec pins the two equal), the registry document the poller's bootstrap
 * inserts from those rows, and the route line the daily sync stores, whose points are the stations' own
 * coordinates since getRoutePath was not captured. A test that needs 7800 stored stores it from here.
 */
import { REGIONAL_ROUTES } from "../../../src/bus/bus.constants";
import type { JongroRoute } from "../../../src/bus/bus.types";
import type { JongroArrivalBus, JongroArrivalDoc } from "../../../src/bus/cache/bus-cache.document";
import { toCarNumber } from "../../../src/bus/realtime/bus-realtime.mapper";
import { toBusType, toObservedAt, toTopisDecimal, toTopisInteger } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.rules";
import type { JongroBusSighting } from "../../../src/bus/realtime/jongro/bus-realtime-jongro.types";
import type { JongroRouteDocument } from "../../../src/bus/registry/bus-registry.document";
import { toRegistryStations } from "../../../src/bus/registry/bus-registry.mapper";
import { toObservedStations, toStationsVersion } from "../../../src/bus/registry/bus-registry.rules";
import type { JongroRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.document";
import { toFetchedRoutePath, toRoutePathDocument } from "../../../src/bus/route-path/bus-route-path.mapper";
import { topisRouteStationRow } from "../../../src/bus/route-path/bus-route-path.schema";
import type { FetchedRoutePath } from "../../../src/bus/route-path/bus-route-path.types";
import arrivals from "../../nest/bus/fixtures/topis-7800-arrivals.json";
import positions from "../../nest/bus/fixtures/topis-7800-positions.json";
import stations from "../../nest/bus/fixtures/topis-route-stations-7800.json";

export const ROUTE_7800: JongroRoute = REGIONAL_ROUTES.find((route) => route.code === "7800")!;

/** QUIRK(topis): where every 7800 bus turns back, the position rows' trnstnid (사당역, seq 39). */
export const TURNAROUND_7800 = "121001315";

/** When TOPIS made the captured rows (mkTm 17:51:03 KST). */
export const MADE_AT_7800 = new Date("2026-10-24T08:51:03Z");

type ArrivalRow = (typeof arrivals.msgBody.itemList)[number];

function toBus(row: ArrivalRow, slot: "1" | "2"): JongroArrivalBus {
  const field = (name: string): string => (row as Record<string, string>)[`${name}${slot}`]!;
  const busType = toBusType(field("busType"));
  return {
    traTime: toTopisInteger(field("traTime"))!,
    sectOrd: toTopisInteger(field("sectOrd"))!,
    staOrd: toTopisInteger(row.staOrd)!,
    arrmsg: field("arrmsg"),
    isLast: field("isLast") === "1",
    plainNo: field("plainNo"),
    vehId: field("vehId"),
    rerideDiv: toTopisInteger(field("rerdie_Div")),
    rerideNum: toTopisInteger(field("reride_Num")),
    ...(busType !== null && { busType }),
  };
}

/** The 80 arrival rows as the client reads them. */
export function arrivalDocs7800(): JongroArrivalDoc[] {
  return arrivals.msgBody.itemList.map((row) => ({
    stationId: row.stId,
    sequence: row.staOrd,
    stationName: row.stNm,
    carNumber: toCarNumber(row.plainNo1),
    eventDate: row.mkTm,
    stationNumber: row.arsId,
    eta: row.arrmsg1,
    buses: [toBus(row, "1"), toBus(row, "2")],
  }));
}

/** The 15 position rows as the client reads them. */
export function sightings7800(): JongroBusSighting[] {
  return positions.msgBody.itemList.map((row) => {
    const busType = toBusType(row.busType);
    return {
      stationId: row.lastStnId,
      latitude: row.gpsY,
      longitude: row.gpsX,
      carNumber: toCarNumber(row.plainNo),
      plainNo: row.plainNo,
      turnaroundStationId: row.trnstnid,
      vehicleId: row.vehId,
      sectOrd: toTopisInteger(row.sectOrd)!,
      sectDist: toTopisDecimal(row.sectDist)!,
      fullSectDist: toTopisDecimal(row.fullSectDist)!,
      isAtStop: row.stopFlag === "1",
      observedAt: toObservedAt(row.dataTm)!,
      lastStTm: toTopisInteger(row.lastStTm) ?? undefined,
      ...(busType !== null && { busType }),
    };
  });
}

/** The registry document the bootstrap inserts from the captured rows. */
export function registryDoc7800(syncedAt = MADE_AT_7800): JongroRouteDocument {
  const observed = toObservedStations(arrivalDocs7800());
  return {
    _id: ROUTE_7800.id,
    stations: toRegistryStations(observed),
    turnaroundTopisId: TURNAROUND_7800,
    stationsVersion: toStationsVersion(observed, TURNAROUND_7800),
    syncedAt,
  };
}

/** The line the daily sync fetches: the 80 stations of getStaionByRoute, and those stations' coordinates as its points. */
export function fetchedRoutePath7800(): FetchedRoutePath {
  const rows = stations.msgBody.itemList.map((row) => topisRouteStationRow.parse(row));
  return toFetchedRoutePath(rows.map((row) => ({ no: row.seq, gpsX: row.gpsX, gpsY: row.gpsY })), rows);
}

export function routePathDoc7800(syncedAt = MADE_AT_7800): JongroRoutePathDocument {
  return toRoutePathDocument(ROUTE_7800, fetchedRoutePath7800(), syncedAt);
}
