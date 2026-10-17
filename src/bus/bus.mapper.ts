import { JONGRO_ROUTE_ID_PREFIX, SEOUL_BUS_API_URL } from "./bus.constants";
import type { JongroRoute } from "./bus.types";
import type { JongroRoutesFile } from "./bus.wire";

type JongroRouteEntry = JongroRoutesFile[number];

export function toJongroArrivalsUrl(busRouteId: string, serviceKey: string): string {
  return `${SEOUL_BUS_API_URL}/arrive/getArrInfoByRouteAll?serviceKey=${serviceKey}&busRouteId=${busRouteId}&resultType=json`;
}

export function toJongroRoute(entry: JongroRouteEntry, serviceKey: string): JongroRoute {
  return {
    id: entry.id,
    code: entry.id.slice(JONGRO_ROUTE_ID_PREFIX.length),
    busRouteId: entry.busRouteId,
    themeColor: entry.themeColor,
    iconType: entry.iconType,
    refreshInterval: entry.refreshInterval,
    seatCount: entry.seatCount,
    arrivalsUrl: toJongroArrivalsUrl(entry.busRouteId, serviceKey),
    transferLinesByArsId: entry.transferLinesByArsId,
  };
}
