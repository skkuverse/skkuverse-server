import { pick } from "../../infra/i18n";
import type { I18n, SupportedLang } from "../../infra/types";
import type { LocalizedName } from "../../subway/subway.types";
import type { ResolvedStops, ScheduleStop, ScheduleStopCatalog, SequenceStop, StopGuide, StopPanorama } from "./bus-stops.types";
import type { ServedSequenceStop, ServedStop, StopMap } from "../bus.wire";

type SubwayTitles = ReadonlyMap<string, LocalizedName>;
type StopSubwayStation = NonNullable<ServedStop["subwayStation"]>;

interface StopSources {
  catalog: Readonly<ScheduleStopCatalog>;
  /** WHY: station slug → title; absent where no stop names a station. */
  subwayTitles?: SubwayTitles;
  /** WHY: false leaves out every stop's map, guide or not; absent serves each guide. */
  hasStopMaps?: boolean;
}

// QUIRK(naver): NAVER Map's unofficial panorama app link, built here so a format change is one deploy, not an
// app update; each value appears three times, for the app, the redirect page and the web viewer's fallbackUrl.
export function toStreetViewUrl({ panoId, pan, tilt, fov }: StopPanorama): string {
  const fallback = `https://viewer.map.naver.com/panorama/?id=${panoId}&heading=${pan}&tilt=${tilt}&fov=${fov}`;
  return (
    "https://inapp.map.naver.com/launchApp/panorama/street" +
    `?street=on&vrpanoid=${panoId}&vrpanopan=${pan}&vrpanotilt=${tilt}&vrpanofov=${fov}` +
    "&appTargetPage=panorama%2Fstreet" +
    `&id=${panoId}&pan=${pan}&tilt=${tilt}&fov=${fov}` +
    `&fallbackUrl=${encodeURIComponent(fallback)}` +
    "&app=Y&appmarket=N"
  );
}

// WHY: the catalog loader refused a name or label without a Korean text, which pick() falls back to.
const textIn = (text: I18n, lang: SupportedLang): string => pick(text, lang) ?? text.ko;

/** WHY: places become markers labeled in the request language, walks become paths; both arrays always present. */
function toStopMap(guide: StopGuide, lang: SupportedLang): StopMap {
  return {
    markers: (guide.places ?? []).map((p) => ({ id: p.id, kind: p.kind, label: textIn(p.name, lang), number: p.number, coords: p.coords })),
    paths: (guide.walks ?? []).map((w) => ({ kind: "walk" as const, from: w.from, to: w.to, points: w.path })),
  };
}

function toStopSubwayStation({ id: stopId, subwayStationId: id }: ScheduleStop, lang: SupportedLang, titles: SubwayTitles): StopSubwayStation | null {
  if (id === undefined) return null;
  const title = titles.get(id);
  if (!title) throw new Error(`schedule-stops.json: stop ${stopId} names subway station ${id}, which the catalog loader refuses`);
  return { id, title: title[lang] };
}

// WHY: optional fields appear only when the catalog sets their source; the photo is the variant in the request
// language, else the original, which has no words and reads the same in every language.
function toServedStop(stop: ScheduleStop, lang: SupportedLang, titles: SubwayTitles): ServedStop {
  const served: ServedStop = { id: stop.id, name: textIn(stop.name, lang) };
  const detail = pick(stop.detail, lang);
  if (detail !== null) served.detail = detail;
  if (stop.coords) served.coords = stop.coords;
  if (stop.photo) served.photoUrl = stop.photo.localized?.[lang] ?? stop.photo.original;
  if (stop.panorama) served.streetViewUrl = toStreetViewUrl(stop.panorama);
  if (stop.guide) served.map = toStopMap(stop.guide, lang);
  const subwayStation = toStopSubwayStation(stop, lang, titles);
  if (subwayStation) served.subwayStation = subwayStation;
  return served;
}

const withoutGuide = ({ guide: _guide, ...stop }: ScheduleStop): ScheduleStop => stop;

function toServedSequenceStop(entry: SequenceStop, name: I18n, lang: SupportedLang): ServedSequenceStop {
  const served: ServedSequenceStop = { label: textIn(name, lang), action: entry.action, timing: entry.timing };
  if (entry.stopId) served.stopId = entry.stopId;
  const note = pick(entry.note, lang);
  if (note !== null) served.note = note;
  const detail = pick(entry.detail, lang);
  if (detail !== null) served.detail = detail;
  return served;
}

/**
 * WHY: the stop sequences of some services and the catalog stops they reference, for one language: a sequence stop
 * is named by its catalog stop or its own label, `stops` lists each referenced stop once in order of first
 * reference, and a service without sequences is absent from `sequences`.
 */
export function resolveStopSequences(serviceIds: readonly string[], lang: SupportedLang, { catalog, subwayTitles = new Map(), hasStopMaps = true }: StopSources): ResolvedStops {
  const sequences: ResolvedStops["sequences"] = {};
  const referenced: string[] = [];
  const byId = (id: string): ScheduleStop => {
    const stop = catalog.stops.find((s) => s.id === id);
    if (!stop) throw new Error(`schedule-stops.json: no stop ${id}, which the catalog loader refuses`);
    return stop;
  };
  const nameOf = (entry: SequenceStop): I18n => {
    if (entry.stopId) return byId(entry.stopId).name;
    if (!entry.label) throw new Error("schedule-stops.json: a sequence stop with neither stopId nor label, which the catalog loader refuses");
    return entry.label;
  };
  for (const serviceId of serviceIds) {
    const byRouteType = catalog.sequences[serviceId];
    if (!byRouteType) continue;
    sequences[serviceId] = Object.fromEntries(
      Object.entries(byRouteType).map(([routeType, sequence]) => [
        routeType,
        sequence.map((entry) => {
          if (entry.stopId && !referenced.includes(entry.stopId)) referenced.push(entry.stopId);
          return toServedSequenceStop(entry, nameOf(entry), lang);
        }),
      ]),
    );
  }
  const catalogStops = referenced.map((id) => (hasStopMaps ? byId(id) : withoutGuide(byId(id))));
  return { sequences, stops: catalogStops.map((stop) => toServedStop(stop, lang, subwayTitles)) };
}
