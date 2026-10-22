import moment from "moment-timezone";
import { KST_TIME_ZONE } from "../shared/time-zone.constants";
import { JONGRO_ROUTE_ID_PREFIX } from "./bus.constants";
import type { JongroRoute, JongroRouteIdentity } from "./bus.types";

export function toJongroRoute(identity: JongroRouteIdentity): JongroRoute {
  return {
    id: identity.id,
    code: identity.id.slice(JONGRO_ROUTE_ID_PREFIX.length),
    busRouteId: identity.busRouteId,
  };
}

export function toKstInstant(ms: number): string {
  return moment(ms).tz(KST_TIME_ZONE).format("YYYY-MM-DDTHH:mm:ssZ");
}
