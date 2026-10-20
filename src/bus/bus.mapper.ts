import { JONGRO_ROUTE_ID_PREFIX } from "./bus.constants";
import type { JongroRoute, JongroRouteIdentity } from "./bus.types";

export function toJongroRoute(identity: JongroRouteIdentity): JongroRoute {
  return {
    id: identity.id,
    code: identity.id.slice(JONGRO_ROUTE_ID_PREFIX.length),
    busRouteId: identity.busRouteId,
  };
}
