import moment from "moment-timezone";
import { pick } from "../infra/i18n";
import type { I18n, SupportedLang } from "../infra/types";
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

type LineStation = { name: string; stopId: string | null };

/** WHY: each stop of the HSSC line named as its own stop page names it; a position with no stop keeps the line's name. */
export function toCatalogNamedLine(line: readonly LineStation[], stops: ReadonlyArray<{ id: string; name: I18n }>, lang: SupportedLang): LineStation[] {
  return line.map(({ name, stopId }) => {
    if (stopId === null) return { name, stopId };
    const stop = stops.find((candidate) => candidate.id === stopId);
    if (!stop) throw new Error(`bus-stops: the HSSC line names stop ${stopId}, which a push refuses`);
    return { name: pick(stop.name, lang) ?? stop.name.ko, stopId };
  });
}
