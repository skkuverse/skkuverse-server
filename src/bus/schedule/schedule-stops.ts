/**
 * Boarding-stop catalog for schedule groups.
 *
 * `schedule-stops.json` is the single source of truth for where each run of a
 * schedule service stops: the boarding stops (names, photos, street view
 * frame, the subway exit and the walk from it) and, per service and route
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

  const hasExit = "exit" in stop;
  const hasPath = "walkPath" in stop;
  if (hasExit !== hasPath) {
    errors.push(`${label}: exit and walkPath must be set together`);
  } else if (hasExit) {
    const exit = stop.exit;
    const walk = stop.walkPath;
    if (!isPlainObject(exit) || !isIntIn(exit.number, 1, 99) || !isKoreanLatLng(exit.coords)) {
      errors.push(`${label}: exit must be { number, coords } with coords inside South Korea`);
    } else if (!Array.isArray(walk) || walk.length < 2) {
      errors.push(`${label}: walkPath must have at least two points`);
    } else if (!walk.every(isKoreanLatLng)) {
      errors.push(`${label}: every walkPath point must be { lat, lng } inside South Korea`);
    } else if (!sameLatLng(walk[0]!, exit.coords)) {
      errors.push(`${label}: walkPath must start at the exit's coordinates`);
    } else if (!isKoreanLatLng(stop.coords) || !sameLatLng(walk[walk.length - 1]!, stop.coords)) {
      errors.push(`${label}: walkPath must end at the stop's coordinates`);
    } else {
      let meters = 0;
      for (let i = 1; i < walk.length; i++) meters += haversineM(walk[i - 1]!, walk[i]!);
      if (meters > MAX_WALK_M) {
        errors.push(`${label}: walkPath is ${Math.round(meters)} m, longer than ${MAX_WALK_M} m`);
      }
    }
  }

  return errors;
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
        } else {
          const labelErr = i18nError(st.label);
          if (labelErr) errors.push(`${sp}: label ${labelErr}`);
        }
        if ("detail" in st) {
          const detailErr = i18nError(st.detail);
          if (detailErr) errors.push(`${sp}: detail ${detailErr}`);
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
