import { JONGRO_ROUTE_ID_PREFIX } from "./bus.constants";
import type { JongroRoute } from "./bus.types";
import type { JongroRoutesFile } from "./bus.wire";

type JongroRouteEntry = JongroRoutesFile[number];

export function toJongroRoute(entry: JongroRouteEntry): JongroRoute {
  return {
    id: entry.id,
    code: entry.id.slice(JONGRO_ROUTE_ID_PREFIX.length),
    busRouteId: entry.busRouteId,
    themeColor: entry.themeColor,
    iconType: entry.iconType,
    refreshInterval: entry.refreshInterval,
    seatCount: entry.seatCount,
    transferLinesByArsId: entry.transferLinesByArsId,
  };
}
