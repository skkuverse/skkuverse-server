/**
 * Boarding-stop catalog for schedule groups.
 *
 * `schedule-stops.json` is the single source of truth for where each run of a
 * schedule service stops: the stops (names, photos, street view frame, and the
 * map guide — the subway exit and the walk between it and the stop) and, per
 * service and route
 * type, the sequence of stops every run passes — where riders board and where
 * they get off, and whether the timetable's time there is scheduled or an
 * estimate. A timetable entry's `stopTimes` gives one time per sequence stop.
 * It is a committed file rather than data in `service-config.ts` so that a
 * later change can serve the same catalog to skkuverse-web's info pages.
 *
 * Validated at module load with the fail-fast pattern of
 * `../registry/jongro-registry.ts`: a bad catalog exits the process, because a
 * half-valid one would put a wrong boarding spot on a rider's screen.
 *
 * Route types are not checked here — the badges they must match live in code
 * (`getBusGroups()`), so a jest test over the built config checks them.
 */
import fs from "fs";
import path from "path";
import logger from "../../infra/logger";
import { isMediaUrl } from "../../infra/media-url";
import { SUPPORTED_LANGS } from "../../infra/types";
import serviceConfig from "./service-config";
import type { LatLng, ScheduleStopCatalog } from "../types";

const isTest = process.env.NODE_ENV === "test";

const PANO_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const MAX_WALK_M = 500;
// The walk end that means the stop itself; never a place id.
const STOP_END = "stop";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonBlank(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** `ko` required; `en`/`zh` optional but never blank when present. */
function i18nError(v: unknown): string | null {
  if (!isPlainObject(v)) return "must be an object with a Korean text";
  if (!isNonBlank(v.ko)) return "has no Korean text";
  for (const lang of ["en", "zh"]) {
    if (lang in v && !isNonBlank(v[lang])) return `has a blank ${lang} text`;
  }
  return null;
}

/** South Korea, generously: a swapped lat/lng lands far outside it. */
function isKoreanLatLng(v: unknown): v is LatLng {
  return (
    isPlainObject(v) &&
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    v.lat >= 33 &&
    v.lat <= 39 &&
    v.lng >= 124 &&
    v.lng <= 132
  );
}

function sameLatLng(a: LatLng, b: LatLng): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/** Great-circle distance in meters. */
export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function isIntIn(v: unknown, min: number, max: number): boolean {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

function stopErrors(stop: Record<string, unknown>, label: string): string[] {
  const errors: string[] = [];

  const nameErr = i18nError(stop.name);
  if (nameErr) errors.push(`${label}: name ${nameErr}`);
  if ("detail" in stop) {
    const detailErr = i18nError(stop.detail);
    if (detailErr) errors.push(`${label}: detail ${detailErr}`);
  }
  if ("coords" in stop && !isKoreanLatLng(stop.coords)) {
    errors.push(`${label}: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)`);
  }

  if ("photo" in stop) {
    const photo = stop.photo;
    if (!isPlainObject(photo)) {
      errors.push(`${label}: photo must be an object`);
    } else {
      if (!("original" in photo)) {
        errors.push(`${label}: photo has variants but no original`);
      } else if (!isMediaUrl(photo.original)) {
        errors.push(`${label}: photo.original is not a media.skkuverse.com URL`);
      }
      if ("localized" in photo) {
        if (!isPlainObject(photo.localized)) {
          errors.push(`${label}: photo.localized must be an object`);
        } else {
          for (const [lang, url] of Object.entries(photo.localized)) {
            if (!(SUPPORTED_LANGS as readonly string[]).includes(lang)) {
              errors.push(`${label}: photo variant for unsupported language "${lang}"`);
            } else if (!isMediaUrl(url)) {
              errors.push(`${label}: photo.localized.${lang} is not a media.skkuverse.com URL`);
            }
          }
        }
      }
    }
  }

  if ("panorama" in stop) {
    const p = stop.panorama;
    if (!isPlainObject(p)) {
      errors.push(`${label}: panorama must be an object`);
    } else {
      if (typeof p.panoId !== "string" || !PANO_ID_RE.test(p.panoId)) {
        errors.push(`${label}: panorama.panoId must be 22 characters of A-Z, a-z, 0-9, - and _`);
      }
      if (!isIntIn(p.pan, -180, 180)) errors.push(`${label}: panorama.pan must be an integer in -180..180`);
      if (!isIntIn(p.tilt, -90, 90)) errors.push(`${label}: panorama.tilt must be an integer in -90..90`);
      if (!isIntIn(p.fov, 25, 80)) errors.push(`${label}: panorama.fov must be an integer in 25..80`);
    }
  }

  for (const legacy of ["exit", "walkPath"]) {
    if (legacy in stop) errors.push(`${label}: ${legacy} moved to guide (guide.places and guide.walks)`);
  }
  if ("guide" in stop) errors.push(...guideErrors(stop, label));

  return errors;
}

/**
 * The map guide: typed places around the stop and walks between them and the
 * stop. Only what today's app can draw is accepted (design D3): a reserved
 * kind written now would reach builds that cannot render it.
 */
function guideErrors(stop: Record<string, unknown>, label: string): string[] {
  const errors: string[] = [];
  const guide = stop.guide;
  if (!isPlainObject(guide)) return [`${label}: guide must be an object`];
  // A map with no position to center on is not one.
  if (!isKoreanLatLng(stop.coords)) errors.push(`${label}: guide needs the stop's coordinates`);

  // Place id → coordinates, for the places a walk may end at.
  const places = new Map<string, LatLng>();
  if ("places" in guide) {
    if (!Array.isArray(guide.places)) {
      errors.push(`${label}: guide.places must be an array`);
    } else {
      const seen = new Set<string>();
      guide.places.forEach((p, i) => {
        const at = `${label}: guide.places[${i}]`;
        if (!isPlainObject(p)) {
          errors.push(`${at} must be an object`);
          return;
        }
        const idOk = isNonBlank(p.id) && p.id !== STOP_END && !seen.has(p.id);
        if (!isNonBlank(p.id)) errors.push(`${at} needs a non-empty id`);
        else if (p.id === STOP_END) errors.push(`${at}: id "${STOP_END}" is reserved for the stop itself`);
        else if (seen.has(p.id)) errors.push(`${at}: duplicate place id ${p.id}`);
        if (isNonBlank(p.id)) seen.add(p.id);
        if (p.kind !== "subwayExit") errors.push(`${at}: kind must be "subwayExit", not ${JSON.stringify(p.kind)}`);
        else if (!isIntIn(p.number, 1, 99)) errors.push(`${at}: number must be an integer in 1..99`);
        const nameErr = i18nError(p.name);
        if (nameErr) errors.push(`${at}: name ${nameErr}`);
        if (!isKoreanLatLng(p.coords)) errors.push(`${at}: coords must be { lat, lng } inside South Korea`);
        else if (idOk) places.set(p.id as string, p.coords);
      });
    }
  }

  if ("walks" in guide) {
    if (!Array.isArray(guide.walks)) {
      errors.push(`${label}: guide.walks must be an array`);
    } else {
      guide.walks.forEach((w, i) => {
        const at = `${label}: guide.walks[${i}]`;
        if (!isPlainObject(w)) {
          errors.push(`${at} must be an object`);
          return;
        }
        const ends = [w.from, w.to];
        if (ends.filter((e) => e === STOP_END).length !== 1) {
          errors.push(`${at} must have exactly one "${STOP_END}" end`);
          return;
        }
        const other = ends.find((e) => e !== STOP_END);
        if (typeof other !== "string" || !places.has(other)) {
          errors.push(`${at}: ${JSON.stringify(other)} is not a place of this stop`);
          return;
        }
        const points = w.path;
        if (!Array.isArray(points) || points.length < 2) {
          errors.push(`${at}: path must have at least two points`);
        } else if (!points.every(isKoreanLatLng)) {
          errors.push(`${at}: every path point must be { lat, lng } inside South Korea`);
        } else if (isKoreanLatLng(stop.coords)) {
          const stopCoords = stop.coords;
          const endCoords = (end: unknown) => (end === STOP_END ? stopCoords : places.get(end as string)!);
          if (!sameLatLng(points[0]!, endCoords(w.from))) {
            errors.push(`${at}: path must start at ${String(w.from)}'s coordinates`);
          } else if (!sameLatLng(points[points.length - 1]!, endCoords(w.to))) {
            errors.push(`${at}: path must end at ${String(w.to)}'s coordinates`);
          } else {
            let meters = 0;
            for (let k = 1; k < points.length; k++) meters += haversineM(points[k - 1]!, points[k]!);
            if (meters > MAX_WALK_M) {
              errors.push(`${at}: path is ${Math.round(meters)} m, longer than ${MAX_WALK_M} m`);
            }
          }
        }
      });
    }
  }

  return errors;
}

/** Stop ids by which way their walks go: to the stop (boarding) or from it (alighting). */
function walkDirections(stops: unknown[]): { toStop: Set<string>; fromStop: Set<string> } {
  const toStop = new Set<string>();
  const fromStop = new Set<string>();
  for (const s of stops) {
    if (!isPlainObject(s) || !isNonBlank(s.id) || !isPlainObject(s.guide) || !Array.isArray(s.guide.walks)) continue;
    for (const w of s.guide.walks) {
      // A walk without exactly one stop end is already reported by guideErrors.
      if (!isPlainObject(w) || (w.to === STOP_END) === (w.from === STOP_END)) continue;
      if (w.to === STOP_END) toStop.add(s.id);
      else fromStop.add(s.id);
    }
  }
  return { toStop, fromStop };
}

/**
 * Every problem with a raw catalog, each naming its stop or service. Empty
 * means valid. Pure, so tests can drive bad inputs without the process exit.
 */
export function validateStopCatalog(raw: unknown, knownServiceIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (!isPlainObject(raw) || !Array.isArray(raw.stops) || !isPlainObject(raw.sequences)) {
    return ["schedule-stops.json must be { stops: [], sequences: {} }"];
  }

  const stopIds = new Set<string>();
  raw.stops.forEach((s, i) => {
    if (!isPlainObject(s) || !isNonBlank(s.id)) {
      errors.push(`stops[${i}]: must be an object with a non-empty id`);
      return;
    }
    const label = `stop ${s.id}`;
    if (stopIds.has(s.id)) errors.push(`${label}: duplicate id`);
    stopIds.add(s.id);
    errors.push(...stopErrors(s, label));
  });
  const walks = walkDirections(raw.stops);

  for (const [serviceId, byRouteType] of Object.entries(raw.sequences)) {
    const label = `sequences ${serviceId}`;
    if (!knownServiceIds.has(serviceId)) errors.push(`${label}: unknown service`);
    if (!isPlainObject(byRouteType) || Object.keys(byRouteType).length === 0) {
      errors.push(`${label}: must map route types to stop sequences`);
      continue;
    }
    for (const [routeType, seq] of Object.entries(byRouteType)) {
      const at = `${label}.${routeType}`;
      if (!Array.isArray(seq) || seq.length < 2) {
        errors.push(`${at}: must list at least two stops`);
        continue;
      }
      const seen = new Set<string>();
      seq.forEach((st, i) => {
        const sp = `${at}[${i}]`;
        if (!isPlainObject(st)) {
          errors.push(`${sp}: must be an object`);
          return;
        }
        const hasStop = "stopId" in st;
        const hasLabel = "label" in st;
        if (hasStop === hasLabel) {
          errors.push(`${sp}: needs exactly one of stopId and label`);
        } else if (hasStop) {
          if (typeof st.stopId !== "string" || !stopIds.has(st.stopId)) {
            errors.push(`${sp}: unknown stop id ${JSON.stringify(st.stopId)}`);
          } else if (seen.has(st.stopId)) {
            errors.push(`${sp}: stop ${st.stopId} appears twice`);
          } else {
            seen.add(st.stopId);
          }
          // A walk is drawn one way; a stop used the other way would show riders the wrong arrow.
          if (st.action === "alight" && walks.toStop.has(st.stopId as string)) {
            errors.push(`${sp}: stop ${String(st.stopId)} has a walk to the stop (boarding), but this sequence alights there`);
          }
          if (st.action === "board" && walks.fromStop.has(st.stopId as string)) {
            errors.push(`${sp}: stop ${String(st.stopId)} has a walk from the stop (alighting), but this sequence boards there`);
          }
        } else {
          const labelErr = i18nError(st.label);
          if (labelErr) errors.push(`${sp}: label ${labelErr}`);
        }
        for (const field of ["note", "detail"] as const) {
          if (field in st) {
            const err = i18nError(st[field]);
            if (err) errors.push(`${sp}: ${field} ${err}`);
          }
        }
        if (st.action !== "board" && st.action !== "alight") {
          errors.push(`${sp}: action must be "board" or "alight"`);
        }
        if (st.timing !== "scheduled" && st.timing !== "estimated") {
          errors.push(`${sp}: timing must be "scheduled" or "estimated"`);
        }
      });
      // The run departs from its first stop, and a run nobody gets off is not one.
      const first = seq[0] as Record<string, unknown> | undefined;
      if (isPlainObject(first) && first.action !== "board") errors.push(`${at}: the first stop must be a boarding stop`);
      if (!seq.some((st) => isPlainObject(st) && st.action === "alight")) {
        errors.push(`${at}: must have at least one alighting stop`);
      }
    }
  }

  return errors;
}

function deepFreeze<T>(o: T): T {
  if (o === null || typeof o !== "object" || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.getOwnPropertyNames(o)) {
    const v = (o as Record<string, unknown>)[k];
    if (v && typeof v === "object") deepFreeze(v);
  }
  return o;
}

function fatal(message: string): void {
  logger.fatal({ event: "bus.schedule_stops.invalid" }, message);
  if (!isTest) process.exit(1);
}

function loadCatalog(): ScheduleStopCatalog {
  const empty: ScheduleStopCatalog = { stops: [], sequences: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(__dirname, "schedule-stops.json"), "utf8"));
  } catch (err: unknown) {
    fatal(`Cannot load schedule-stops.json: ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
  const errors = validateStopCatalog(raw, new Set(Object.keys(serviceConfig)));
  if (errors.length > 0) {
    for (const e of errors) logger.fatal({ event: "bus.schedule_stops.invalid" }, e);
    fatal(`schedule-stops.json invalid (${errors.length} error(s))`);
    // Never serve a partial catalog, even where the exit is intercepted (tests).
    return empty;
  }
  return deepFreeze(raw as ScheduleStopCatalog);
}

/** The validated, frozen catalog. */
export const stopCatalog: Readonly<ScheduleStopCatalog> = loadCatalog();
