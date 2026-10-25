import { t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import { toCatalogNamedLine } from "../bus.mapper";
import { toStationAction, toTowards } from "../bus.rules";
import type { HsscLineStation } from "../stops/bus-stops.document";
import type { ScheduleStop } from "../stops/bus-stops.types";
import type { LocatedStop, StopRoute } from "../stop-index/bus-stop-index.types";
import { toCampusPoles, toStopCampus } from "./bus-stop-list.rules";
import type { ListedRoute, ListedStop, LocalizedText } from "./bus-stop-list.types";

interface StopLines {
  hsscLine: readonly HsscLineStation[];
  catalogStops: readonly ScheduleStop[];
}

const toLocalized = (textIn: (lang: SupportedLang) => string): LocalizedText => ({ ko: textIn("ko"), en: textIn("en"), zh: textIn("zh") });
const toLocalizedLabel = (key: string): LocalizedText => toLocalized((lang) => t(key, lang));

// WHY: the stop page's own rules in each language, so a listed station heads where its page says.
function toHsscTowards({ hsscLine, catalogStops }: StopLines, stationIndex: number): LocalizedText | null {
  const towardsIn = (lang: SupportedLang): string | null => toTowards(toCatalogNamedLine(hsscLine, catalogStops, lang), stationIndex);
  const ko = towardsIn("ko");
  return ko === null ? null : toLocalized((lang) => towardsIn(lang) ?? ko);
}

function toListedRoute(route: StopRoute, lines: StopLines): ListedRoute {
  const { groupId } = route;
  if (route.kind === "shuttle") {
    const { serviceId, routeType, action } = route;
    return { kind: "timetable", groupId, label: toLocalizedLabel(`busconfig.service.${serviceId}`), serviceId, routeType, action };
  }
  const label = toLocalizedLabel(`busconfig.label.${groupId}`);
  if (route.kind === "jongro") {
    const { towards } = route;
    return { kind: "live", groupId, label, stationIndex: route.stationIndex, towards: towards === null ? null : toLocalized(() => towards), action: toStationAction(undefined) };
  }
  const action = toStationAction(lines.hsscLine[route.stationIndex]);
  return { kind: "live", groupId, label, stationIndex: route.stationIndex, towards: toHsscTowards(lines, route.stationIndex), action };
}

function toPoleNames({ id, poles: [pole] }: LocatedStop): LocalizedText {
  if (!pole) throw new Error(`bus-stops: stop ${id} is neither a local stop nor a pole, which the stop index never builds`);
  return toLocalized(() => pole.stationName);
}

/** WHY: `names` are a local stop's config record names, one per language; a TOPIS pole has none and is its stored Korean name. */
export function toListedStop(stop: LocatedStop, names: LocalizedText | null, lines: StopLines): ListedStop {
  const arsIds = stop.localStop ? stop.localStop.arsIds : stop.poles.flatMap((pole) => pole.arsId ?? []);
  return {
    id: stop.id,
    name: names ?? toPoleNames(stop),
    coords: stop.coords,
    arsIds: arsIds ? [...arsIds] : null,
    campus: toStopCampus({ localStop: stop.localStop, poles: toCampusPoles(stop) }),
    stopAreaId: stop.stopAreaId ?? null,
    routes: stop.routes.map((route) => toListedRoute(route, lines)),
  };
}
