import crypto from "crypto";
import { pick, t } from "../../infra/i18n";
import { WEBVIEW_ORIGIN } from "../../infra/origins";
import type { SupportedLang } from "../../infra/types";
import { HSSCStations } from "./hssc.stations";
import { jongroRoutes, type JongroRoute } from "../registry/jongro-registry";
import { buildStreetViewUrl } from "../schedule/naver-street-view";
import { stopCatalog } from "../schedule/schedule-stops";
import type {
  HsscStation,
  JongroStation,
  LatLng,
  ScheduleStop,
  ScheduleStopCatalog,
  StopGuide,
  StopMap,
} from "../types";

type AnyStation = HsscStation | JongroStation;

/** When the bus list shows a group: always, or from one KST date to another, inclusive. */
type GroupVisibility = { type: "always" } | { type: "dateRange"; from: string; until: string };

const always = (): GroupVisibility => ({ type: "always" });
const dateRange = (from: string, until: string): GroupVisibility => ({ type: "dateRange", from, until });

interface MappedStation {
  index: number;
  name: string;
  subtitle: string | null;
  stationNumber: string | null;
  isFirstStation: boolean;
  isLastStation: boolean;
  isRotationStation: boolean;
  transferLines: AnyStation["transferLines"];
}

function mapStations(stations: ReadonlyArray<AnyStation>): MappedStation[] {
  return stations.map((s, i) => ({
    index: i,
    name: s.stationName,
    subtitle: ("subtitle" in s ? s.subtitle : null) || s.stationNumber || null,
    stationNumber: s.stationNumber || null,
    isFirstStation: s.isFirstStation,
    isLastStation: s.isLastStation,
    isRotationStation: s.isRotationStation,
    transferLines: s.transferLines,
  }));
}

// Builds the SDUI group object for a single Jongro route from the registry.
// Field order MUST match the prior hardcoded entries byte-for-byte so the
// ETag (md5 of JSON.stringify(getBusGroups())) stays stable across this
// refactor.
function buildJongroGroup(route: JongroRoute, lang: SupportedLang) {
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
      routeOverlay: null,
      features: [] as unknown[],
    },
  };
}

interface ServedStop {
  id: string;
  name: string;
  detail?: string;
  coords?: LatLng;
  photoUrl?: string;
  streetViewUrl?: string;
  map?: StopMap;
}

interface ServedSequenceStop {
  label: string;
  action: "board" | "alight";
  timing: "scheduled" | "estimated";
  stopId?: string;
  note?: string;
  detail?: string;
}

/**
 * A stop's guide as its map card: places become markers labeled in the request
 * language, walks become paths. Both arrays are always present, so an empty
 * guide serves the pin-only `{ markers: [], paths: [] }`.
 */
function serveMap(guide: StopGuide, lang: SupportedLang): StopMap {
  return {
    markers: (guide.places ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      label: pick(p.name, lang)!,
      number: p.number,
      coords: p.coords,
    })),
    paths: (guide.walks ?? []).map((w) => ({ kind: "walk" as const, from: w.from, to: w.to, points: w.path })),
  };
}

/**
 * A stop as one language's client sees it. Optional fields appear only when
 * the catalog sets their source, so a stop with no photo has no `photoUrl` key.
 * The photo is the variant whose labels are in the request language, else the
 * original — not chained through English like text, because the original has
 * no words and reads the same in every language.
 */
function serveStop(stop: ScheduleStop, lang: SupportedLang): ServedStop {
  const served: ServedStop = { id: stop.id, name: pick(stop.name, lang)! };
  const detail = pick(stop.detail, lang);
  if (detail !== null) served.detail = detail;
  if (stop.coords) served.coords = stop.coords;
  if (stop.photo) served.photoUrl = stop.photo.localized?.[lang] ?? stop.photo.original;
  if (stop.panorama) served.streetViewUrl = buildStreetViewUrl(stop.panorama);
  // The loader refuses a guide on a stop without coordinates.
  if (stop.guide) served.map = serveMap(stop.guide, lang);
  return served;
}

/**
 * The stop sequences of some services and the catalog stops they reference,
 * for one language. A sequence stop is named by its catalog stop or its own
 * label; `stops` lists each referenced catalog stop once, in order of first
 * reference. A service without sequences is absent from `sequences`.
 */
function resolveStopSequences(
  serviceIds: readonly string[],
  lang: SupportedLang,
  catalog: Readonly<ScheduleStopCatalog> = stopCatalog,
): { sequences: Record<string, Record<string, ServedSequenceStop[]>>; stops: ServedStop[] } {
  const sequences: Record<string, Record<string, ServedSequenceStop[]>> = {};
  const referenced: string[] = [];
  // The catalog loader already refused a sequence naming an unknown stop.
  const byId = (id: string) => catalog.stops.find((s) => s.id === id)!;
  for (const serviceId of serviceIds) {
    const byRouteType = catalog.sequences[serviceId];
    if (!byRouteType) continue;
    sequences[serviceId] = Object.fromEntries(
      Object.entries(byRouteType).map(([routeType, seq]) => [
        routeType,
        seq.map((st) => {
          const name = st.stopId ? byId(st.stopId).name : st.label;
          const served: ServedSequenceStop = { label: pick(name, lang)!, action: st.action, timing: st.timing };
          if (st.stopId) {
            served.stopId = st.stopId;
            if (!referenced.includes(st.stopId)) referenced.push(st.stopId);
          }
          const note = pick(st.note, lang);
          if (note !== null) served.note = note;
          const detail = pick(st.detail, lang);
          if (detail !== null) served.detail = detail;
          return served;
        }),
      ]),
    );
  }
  const stops = referenced.map((id) => serveStop(byId(id), lang));
  return { sequences, stops };
}

type ServedSequences = ReturnType<typeof resolveStopSequences>["sequences"];

/**
 * A schedule group's service tabs, in the given order. A service with stop
 * sequences carries them as `stopSequences`; one without has no key, so its
 * entry serializes exactly as in v1.
 */
function scheduleServices(serviceIds: readonly string[], lang: SupportedLang, sequences: ServedSequences) {
  return serviceIds.map((serviceId) => ({
    serviceId,
    label: t(`busconfig.service.${serviceId}`, lang),
    endpoint: `/bus/schedule/data/${serviceId}/smart`,
    ...(sequences[serviceId] ? { stopSequences: sequences[serviceId] } : {}),
  }));
}

const CAMPUS_SERVICE_IDS = ["campus-inja", "campus-jain"] as const;

/**
 * 인자셔틀: the regular shuttle every weekday and the Friday 학부대학 runs, as
 * route types `regular` and `hakbu`. Its v1 fields are exactly as before v2 (a
 * build without the OTA reads the same group); v2 adds `stops` and each
 * service's `stopSequences`. It keeps the segmented selector, so there is no
 * `serviceSelector` key.
 */
function buildCampusGroup(lang: SupportedLang) {
  const { sequences, stops } = resolveStopSequences(CAMPUS_SERVICE_IDS, lang);
  return {
    id: "campus",
    screenType: "schedule",
    label: t("busconfig.label.campus", lang),
    visibility: always(),
    card: {
      themeColor: "003626",
      iconType: "shuttle",
      busTypeText: t("buslist.hssc.busTypeText", lang),
      subtitle: t("buslist.inja.subtitle", lang),
    },
    screen: {
      defaultServiceId: "campus-inja",
      services: scheduleServices(CAMPUS_SERVICE_IDS, lang, sequences),
      // Retired with GET /bus/campus/eta: the card's driving ETA came from a
      // Naver Directions subscription that stopped authorizing. `null` is the
      // shape the app already handles (fasttrack below) — it hides the card
      // and never requests the ETA.
      heroCard: null,
      routeBadges: [
        { id: "regular", label: t("busconfig.badge.regular", lang), color: "003626" },
        { id: "hakbu", label: t("busconfig.badge.hakbu", lang), color: "1565C0" },
      ],
      ...(stops.length > 0 ? { stops } : {}),
      features: [{ type: "info", url: `${WEBVIEW_ORIGIN}/bus/campus/info` }],
    },
  };
}

const COMMUTE_SERVICE_IDS = [
  "commute-jeongja",
  "commute-jamsil",
  "commute-dogok",
  "commute-gangnam-yangjae",
  "commute-gwanggyo",
] as const;

/**
 * 자과캠 통학셔틀 (pilot, 2026-10-19..2026-12-18): one service per route, runs
 * typed by direction (`up` 등교, `down` 하교). Each run is one entry; its
 * `stopTimes` give the time at every stop of the service's sequence for that
 * direction (boarding stops, then where riders get off), so the 강남·양재 bus is
 * one row that boards at 강남 and 양재. The first group to use the v2 fields:
 * `serviceSelector`, `services[].stopSequences`, `screen.stops`. Builds that
 * predate them ignore the keys and render the v1 screen.
 */
function buildCommuteGroup(lang: SupportedLang) {
  const { sequences, stops } = resolveStopSequences(COMMUTE_SERVICE_IDS, lang);
  return {
    id: "commute",
    screenType: "schedule",
    label: t("busconfig.label.commute", lang),
    visibility: dateRange("2026-10-19", "2026-12-18"),
    card: {
      themeColor: "003626",
      iconType: "shuttle",
      busTypeText: t("buslist.hssc.busTypeText", lang),
      subtitle: t("buslist.commute.subtitle", lang),
    },
    screen: {
      defaultServiceId: "commute-jeongja",
      serviceSelector: "chips",
      services: scheduleServices(COMMUTE_SERVICE_IDS, lang, sequences),
      heroCard: null,
      routeBadges: [
        { id: "up", label: t("busconfig.badge.up", lang), color: "003626" },
        { id: "down", label: t("busconfig.badge.down", lang), color: "1565C0" },
      ],
      ...(stops.length > 0 ? { stops } : {}),
      features: [{ type: "info", url: `${WEBVIEW_ORIGIN}/bus/commute/info` }],
    },
  };
}

const etagCache: Map<string, string> = new Map();

/**
 * Returns ordered array of bus groups for the client SDUI.
 * Order: hssc, campus, fasttrack, commute, then every jongro route in registry
 * order (jongro02, jongro07, jongro08).
 */
function getBusGroups(lang: SupportedLang = "ko") {
  return [
    // 1. HSSC (realtime)
    {
      id: "hssc",
      screenType: "realtime",
      label: t("busconfig.label.hssc", lang),
      visibility: always(),
      card: {
        themeColor: "003626",
        iconType: "shuttle",
        busTypeText: t("buslist.hssc.busTypeText", lang),
        subtitle: t("buslist.hssc.subtitle", lang),
      },
      screen: {
        dataEndpoint: "/bus/realtime/data/hssc",
        refreshInterval: 10,
        lastStationIndex: 10,
        stations: mapStations(HSSCStations),
        routeOverlay: null,
        features: [
          { type: "info", url: `${WEBVIEW_ORIGIN}/bus/hssc/info` },
        ],
      },
    },

    // 2. 인자셔틀 (schedule)
    buildCampusGroup(lang),

    // 3. Fasttrack (schedule, date-limited)
    {
      id: "fasttrack",
      screenType: "schedule",
      label: t("busconfig.label.fasttrack", lang),
      visibility: dateRange("2026-03-01", "2026-03-07"),
      card: {
        themeColor: "E65100",
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
          },
        ],
        heroCard: null,
        routeBadges: [
          { id: "fasttrack", label: t("busconfig.badge.fasttrack", lang), color: "E65100" },
        ],
        features: [],
      },
    },

    // 4. 자과캠 통학셔틀 (schedule, pilot window)
    buildCommuteGroup(lang),

    // 5..N. Jongro routes (realtime) — generated from `jongro-routes.json`.
    ...jongroRoutes.map((r) => buildJongroGroup(r, lang)),
  ];
}

/**
 * Compute a quoted MD5 ETag for the given language's config output.
 * Cached per language.
 */
function computeEtag(lang: SupportedLang = "ko"): string {
  const cached = etagCache.get(lang);
  if (cached) return cached;

  const json = JSON.stringify(getBusGroups(lang));
  const hash = crypto.createHash("md5").update(json).digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(lang, etag);
  return etag;
}

type BusGroup = ReturnType<typeof getBusGroups>[number];

/**
 * Returns a single group by id, or null if not found.
 */
function getGroupById(
  id: string,
  lang: SupportedLang = "ko",
): BusGroup | null {
  return getBusGroups(lang).find((g) => g.id === id) || null;
}

/**
 * Compute a quoted MD5 ETag for a single group.
 * Cached per id:lang.
 */
function computeGroupEtag(
  id: string,
  lang: SupportedLang = "ko",
): string | null {
  const cacheKey = `${id}:${lang}`;
  const cached = etagCache.get(cacheKey);
  if (cached) return cached;

  const group = getGroupById(id, lang);
  if (!group) return null;

  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify(group))
    .digest("hex");
  const etag = `"${hash}"`;
  etagCache.set(cacheKey, etag);
  return etag;
}

export {
  getBusGroups,
  computeEtag,
  getGroupById,
  computeGroupEtag,
  mapStations,
  resolveStopSequences,
};
