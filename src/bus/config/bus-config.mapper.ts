import { t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import { ESTIMATES_MAX_AGE_S } from "../bus.constants";
import { serviceConfigOf } from "../bus.rules";
import type { JongroRoute } from "../bus.types";
import type { RegistryRoute } from "../registry/bus-registry.types";
import type { ResolvedStops } from "../stops/bus-stops.types";
import type { BusGroup, ServiceRefresh } from "./bus-config.wire";
import {
  CAMPUS_SERVICE_IDS,
  COMMUTE_SERVICE_IDS,
  FASTTRACK_ORANGE,
  HAKBU_BLUE,
  HSSC_STATIONS,
  SKKU_GREEN,
} from "./bus-config.constants";
import { COMMUTE_VISIBILITY, FASTTRACK_VISIBILITY } from "./bus-config.config";
import type { AnyStation, BusGroupSources, BusGroupVisibility, MappedStation } from "./bus-config.types";

const always = (): BusGroupVisibility => ({ type: "always" });

const shuttleCard = (lang: SupportedLang, subtitleKey: string) => ({
  themeColor: SKKU_GREEN,
  iconType: "shuttle",
  busTypeText: t("buslist.hssc.busTypeText", lang),
  subtitle: t(subtitleKey, lang),
});

const routeBadge = (id: string, color: string, lang: SupportedLang) => ({ id, label: t(`busconfig.badge.${id}`, lang), color });

export function mapStations(stations: ReadonlyArray<AnyStation>): MappedStation[] {
  return stations.map((station, index) => ({
    index,
    name: station.stationName,
    subtitle: ("subtitle" in station ? station.subtitle : null) || null,
    stationNumber: station.stationNumber || null,
    isFirstStation: station.isFirstStation,
    isLastStation: station.isLastStation,
    isRotationStation: station.isRotationStation,
    transferLines: station.transferLines,
  }));
}

// WHY: the field order is the ETag's input (md5 of the JSON), so it never changes for an unchanged group;
// stationsVersion comes last for the same reason.
function toJongroGroup(route: RegistryRoute, lang: SupportedLang) {
  return {
    id: route.id,
    screenType: "realtime" as const,
    label: t(`busconfig.label.${route.id}`, lang),
    visibility: always(),
    card: {
      themeColor: route.themeColor,
      iconType: route.iconType,
      busTypeText: t("buslist.village.busTypeText", lang),
      subtitle: t(`buslist.${route.id}.subtitle`, lang),
    },
    screen: {
      dataEndpoint: `/bus/realtime/data/${route.id}`,
      refreshInterval: route.refreshInterval,
      lastStationIndex: route.stations.length - 1,
      stations: mapStations(route.stations),
      features: [],
      stationsVersion: route.stationsVersion,
    },
  };
}

// WHY: no key without live estimates, since the app shows a refresh button exactly when the key is there.
const refreshOf = (serviceId: string): { refresh?: ServiceRefresh } =>
  serviceConfigOf(serviceId)?.eta ? { refresh: { targets: ["traffic"], intervalSec: ESTIMATES_MAX_AGE_S } } : {};

// WHY: a service without stop sequences has no `stopSequences` key, so its entry serializes as in v1.
function scheduleServices(serviceIds: readonly string[], lang: SupportedLang, sequences: ResolvedStops["sequences"]) {
  return serviceIds.map((serviceId) => ({
    serviceId,
    label: t(`busconfig.service.${serviceId}`, lang),
    endpoint: `/bus/schedule/data/${serviceId}/smart`,
    ...(sequences[serviceId] ? { stopSequences: sequences[serviceId] } : {}),
    ...refreshOf(serviceId),
  }));
}

function toHsscGroup(lang: SupportedLang, webviewOrigin: string) {
  return {
    id: "hssc",
    screenType: "realtime" as const,
    label: t("busconfig.label.hssc", lang),
    visibility: always(),
    card: shuttleCard(lang, "buslist.hssc.subtitle"),
    screen: {
      dataEndpoint: "/bus/realtime/data/hssc",
      refreshInterval: 10,
      lastStationIndex: 10,
      stations: mapStations(HSSC_STATIONS),
      features: [{ type: "info", url: `${webviewOrigin}/bus/hssc/info` }],
    },
  };
}

// WHY: the regular shuttle every weekday and the Friday hakbu runs as route types; its v1 fields are the v1 ones
// unchanged, and it keeps the segmented selector, so there is no `serviceSelector` key. `heroCard: null` hides
// the retired driving-ETA card in every app build.
function toCampusGroup(lang: SupportedLang, { sequences, stops }: ResolvedStops, webviewOrigin: string) {
  return {
    id: "campus",
    screenType: "schedule" as const,
    label: t("busconfig.label.campus", lang),
    visibility: always(),
    card: shuttleCard(lang, "buslist.inja.subtitle"),
    screen: {
      defaultServiceId: "campus-inja",
      services: scheduleServices(CAMPUS_SERVICE_IDS, lang, sequences),
      heroCard: null,
      routeBadges: [routeBadge("regular", SKKU_GREEN, lang), routeBadge("hakbu", HAKBU_BLUE, lang)],
      ...(stops.length > 0 ? { stops } : {}),
      features: [{ type: "info", url: `${webviewOrigin}/bus/campus/info` }],
    },
  };
}

function toFasttrackGroup(lang: SupportedLang) {
  return {
    id: "fasttrack",
    screenType: "schedule" as const,
    label: t("busconfig.label.fasttrack", lang),
    visibility: FASTTRACK_VISIBILITY,
    card: {
      themeColor: FASTTRACK_ORANGE,
      iconType: "shuttle",
      busTypeText: t("busconfig.badge.fasttrack", lang),
      subtitle: t("buslist.fasttrack.subtitle", lang),
    },
    screen: {
      defaultServiceId: "fasttrack-inja",
      services: [
        {
          serviceId: "fasttrack-inja",
          label: t("busconfig.service.campus-inja", lang),
          endpoint: "/bus/schedule/data/fasttrack-inja/smart",
          ...refreshOf("fasttrack-inja"),
        },
      ],
      heroCard: null,
      routeBadges: [routeBadge("fasttrack", FASTTRACK_ORANGE, lang)],
      features: [],
    },
  };
}

function toCommuteGroup(lang: SupportedLang, { sequences, stops }: ResolvedStops, webviewOrigin: string) {
  return {
    id: "commute",
    screenType: "schedule" as const,
    label: t("busconfig.label.commute", lang),
    visibility: COMMUTE_VISIBILITY,
    card: shuttleCard(lang, "buslist.commute.subtitle"),
    screen: {
      defaultServiceId: "commute-jeongja",
      serviceSelector: "chips",
      services: scheduleServices(COMMUTE_SERVICE_IDS, lang, sequences),
      heroCard: null,
      routeBadges: [routeBadge("up", SKKU_GREEN, lang), routeBadge("down", HAKBU_BLUE, lang)],
      ...(stops.length > 0 ? { stops } : {}),
      features: [{ type: "info", url: `${webviewOrigin}/bus/commute/info` }],
    },
  };
}

const FIXED_GROUP_IDS = ["hssc", "campus", "fasttrack", "commute"] as const;

export function toBusGroupIds(routes: ReadonlyArray<Pick<JongroRoute, "id">>): string[] {
  return [...FIXED_GROUP_IDS, ...routes.map((route) => route.id)];
}

/** WHY: the bus groups in the order the app lists them: hssc, campus, fasttrack, commute, then every Jongro route. */
export function toBusGroups({ lang, stops, jongroRoutes, webviewOrigin }: BusGroupSources): BusGroup[] {
  return [
    toHsscGroup(lang, webviewOrigin),
    toCampusGroup(lang, stops.campus, webviewOrigin),
    toFasttrackGroup(lang),
    toCommuteGroup(lang, stops.commute, webviewOrigin),
    ...jongroRoutes.map((route) => toJongroGroup(route, lang)),
  ];
}
