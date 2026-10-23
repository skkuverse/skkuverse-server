import { isMediaUrl } from "../../infra/media-url";
import { SUPPORTED_LANGS } from "../../infra/types";
import { haversineM } from "../../shared/distance.util";
import { isRecord } from "../../shared/object.util";
import { isHsscPassThrough } from "../bus.rules";
import type { ServiceConfigMap } from "../bus.types";
import type { LaneStrategies } from "../eta/lane/bus-eta-lane.types";
import { MAX_ETA_STOPS, MAX_WALK_M, OPTIONAL_LANGS, PANO_ID_PATTERN, STOP_END } from "./bus-stops.constants";
import type { BusStopsData } from "./bus-stops.document";
import type { EtaOptIns } from "./bus-stops.types";
import type { LatLng } from "../../shared/lat-lng.types";

type Raw = Record<string, unknown>;

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// WHY: `ko` is required; `en` and `zh` are optional but never blank when present.
function i18nError(value: unknown): string | null {
  if (!isRecord(value)) return "must be an object with a Korean text";
  if (!isNonBlank(value.ko)) return "has no Korean text";
  const blank = OPTIONAL_LANGS.find((lang) => lang in value && !isNonBlank(value[lang]));
  return blank ? `has a blank ${blank} text` : null;
}

// WHY: South Korea, generously: a swapped lat/lng lands far outside it.
function isKoreanLatLng(value: unknown): value is LatLng {
  if (!isRecord(value) || typeof value.lat !== "number" || typeof value.lng !== "number") return false;
  return value.lat >= 33 && value.lat <= 39 && value.lng >= 124 && value.lng <= 132;
}

const sameLatLng = (first: LatLng, second: LatLng): boolean => first.lat === second.lat && first.lng === second.lng;

const isIntIn = (value: unknown, min: number, max: number): boolean =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

function textErrors(stop: Raw, label: string): string[] {
  const errors: string[] = [];
  const nameError = i18nError(stop.name);
  if (nameError) errors.push(`${label}: name ${nameError}`);
  const detailError = "detail" in stop ? i18nError(stop.detail) : null;
  if (detailError) errors.push(`${label}: detail ${detailError}`);
  if ("coords" in stop && !isKoreanLatLng(stop.coords)) {
    errors.push(`${label}: coords must be { lat, lng } inside South Korea (lat 33–39, lng 124–132)`);
  }
  return errors;
}

function variantErrors(localized: unknown, label: string): string[] {
  if (!isRecord(localized)) return [`${label}: photo.localized must be an object`];
  return Object.entries(localized).flatMap(([lang, url]) => {
    if (!(SUPPORTED_LANGS as readonly string[]).includes(lang)) return [`${label}: photo variant for unsupported language "${lang}"`];
    return isMediaUrl(url) ? [] : [`${label}: photo.localized.${lang} is not a media.skkuverse.com URL`];
  });
}

function photoErrors(photo: unknown, label: string): string[] {
  if (!isRecord(photo)) return [`${label}: photo must be an object`];
  const errors: string[] = [];
  if (!("original" in photo)) errors.push(`${label}: photo has variants but no original`);
  else if (!isMediaUrl(photo.original)) errors.push(`${label}: photo.original is not a media.skkuverse.com URL`);
  if ("localized" in photo) errors.push(...variantErrors(photo.localized, label));
  return errors;
}

function panoramaErrors(panorama: unknown, label: string): string[] {
  if (!isRecord(panorama)) return [`${label}: panorama must be an object`];
  const errors: string[] = [];
  if (typeof panorama.panoId !== "string" || !PANO_ID_PATTERN.test(panorama.panoId)) {
    errors.push(`${label}: panorama.panoId must be 22 characters of A-Z, a-z, 0-9, - and _`);
  }
  if (!isIntIn(panorama.pan, -180, 180)) errors.push(`${label}: panorama.pan must be an integer in -180..180`);
  if (!isIntIn(panorama.tilt, -90, 90)) errors.push(`${label}: panorama.tilt must be an integer in -90..90`);
  if (!isIntIn(panorama.fov, 25, 80)) errors.push(`${label}: panorama.fov must be an integer in 25..80`);
  return errors;
}

function placeIdError(place: Raw, at: string, seen: ReadonlySet<string>): string | null {
  if (!isNonBlank(place.id)) return `${at} needs a non-empty id`;
  if (place.id === STOP_END) return `${at}: id "${STOP_END}" is reserved for the stop itself`;
  return seen.has(place.id) ? `${at}: duplicate place id ${place.id}` : null;
}

function placeKindError(place: Raw, at: string): string | null {
  if (place.kind !== "subwayExit") return `${at}: kind must be "subwayExit", not ${JSON.stringify(place.kind)}`;
  return isIntIn(place.number, 1, 99) ? null : `${at}: number must be an integer in 1..99`;
}

interface PlaceContext {
  places: Map<string, LatLng>;
  seen: Set<string>;
}

// WHY: fills `places` with the coordinates a walk may end at.
function placeErrors(place: unknown, at: string, { places, seen }: PlaceContext): string[] {
  if (!isRecord(place)) return [`${at} must be an object`];
  const idError = placeIdError(place, at, seen);
  if (isNonBlank(place.id)) seen.add(place.id);
  const nameError = i18nError(place.name);
  const errors = [idError, placeKindError(place, at), nameError && `${at}: name ${nameError}`];
  if (!isKoreanLatLng(place.coords)) errors.push(`${at}: coords must be { lat, lng } inside South Korea`);
  else if (idError === null) places.set(place.id as string, place.coords);
  return errors.filter((e): e is string => typeof e === "string");
}

function placesErrors(guide: Raw, label: string, places: Map<string, LatLng>): string[] {
  if (!("places" in guide)) return [];
  if (!Array.isArray(guide.places)) return [`${label}: guide.places must be an array`];
  const context = { places, seen: new Set<string>() };
  return guide.places.flatMap((place, i) => placeErrors(place, `${label}: guide.places[${i}]`, context));
}

const isAt = (point: LatLng | undefined, end: LatLng | undefined): boolean => !!point && !!end && sameLatLng(point, end);

function walkPathError(walk: Raw, at: string, endCoords: (end: unknown) => LatLng | undefined): string | null {
  const points = walk.path as LatLng[];
  if (!isAt(points[0], endCoords(walk.from))) return `${at}: path must start at ${String(walk.from)}'s coordinates`;
  if (!isAt(points.at(-1), endCoords(walk.to))) return `${at}: path must end at ${String(walk.to)}'s coordinates`;
  let meters = 0;
  let previous: LatLng | undefined;
  for (const point of points) {
    if (previous) meters += haversineM(previous, point);
    previous = point;
  }
  return meters > MAX_WALK_M ? `${at}: path is ${Math.round(meters)} m, longer than ${MAX_WALK_M} m` : null;
}

interface WalkContext {
  stop: Raw;
  places: ReadonlyMap<string, LatLng>;
}

function walkShapeError(walk: Raw, at: string, places: ReadonlyMap<string, LatLng>): string | null {
  const ends = [walk.from, walk.to];
  if (ends.filter((end) => end === STOP_END).length !== 1) return `${at} must have exactly one "${STOP_END}" end`;
  const other = ends.find((end) => end !== STOP_END);
  if (typeof other !== "string" || !places.has(other)) return `${at}: ${JSON.stringify(other)} is not a place of this stop`;
  const points = walk.path;
  if (!Array.isArray(points) || points.length < 2) return `${at}: path must have at least two points`;
  return points.every(isKoreanLatLng) ? null : `${at}: every path point must be { lat, lng } inside South Korea`;
}

function walkErrors(walk: unknown, at: string, { stop, places }: WalkContext): string[] {
  if (!isRecord(walk)) return [`${at} must be an object`];
  const shapeError = walkShapeError(walk, at, places);
  if (shapeError) return [shapeError];
  if (!isKoreanLatLng(stop.coords)) return [];
  const stopCoords = stop.coords;
  const error = walkPathError(walk, at, (end) => (end === STOP_END ? stopCoords : places.get(end as string)));
  return error ? [error] : [];
}

function walksErrors(guide: Raw, label: string, context: WalkContext): string[] {
  if (!("walks" in guide)) return [];
  if (!Array.isArray(guide.walks)) return [`${label}: guide.walks must be an array`];
  return guide.walks.flatMap((walk, i) => walkErrors(walk, `${label}: guide.walks[${i}]`, context));
}

// WHY: only what today's app can draw is accepted: a reserved kind written now would reach builds that cannot render it.
function guideErrors(stop: Raw, label: string): string[] {
  const guide = stop.guide;
  if (!isRecord(guide)) return [`${label}: guide must be an object`];
  const errors = isKoreanLatLng(stop.coords) ? [] : [`${label}: guide needs the stop's coordinates`];
  const places = new Map<string, LatLng>();
  errors.push(...placesErrors(guide, label, places));
  errors.push(...walksErrors(guide, label, { stop, places }));
  return errors;
}

function stopErrors(stop: Raw, label: string): string[] {
  const errors = textErrors(stop, label);
  if ("photo" in stop) errors.push(...photoErrors(stop.photo, label));
  if ("panorama" in stop) errors.push(...panoramaErrors(stop.panorama, label));
  for (const legacy of ["exit", "walkPath"]) {
    if (legacy in stop) errors.push(`${label}: ${legacy} moved to guide (guide.places and guide.walks)`);
  }
  if ("guide" in stop) errors.push(...guideErrors(stop, label));
  return errors;
}

function stopsErrors(stops: unknown[], stopIds: Set<string>): string[] {
  return stops.flatMap((stop, index) => {
    if (!isRecord(stop) || !isNonBlank(stop.id)) return [`stops[${index}]: must be an object with a non-empty id`];
    const label = `stop ${stop.id}`;
    const duplicate = stopIds.has(stop.id) ? [`${label}: duplicate id`] : [];
    stopIds.add(stop.id);
    return [...duplicate, ...stopErrors(stop, label)];
  });
}

function walkDirectionOf(stop: unknown): Array<[string, "to" | "from"]> {
  if (!isRecord(stop) || !isNonBlank(stop.id) || !isRecord(stop.guide) || !Array.isArray(stop.guide.walks)) return [];
  const id = stop.id;
  // WHY: a walk without exactly one stop end is already reported by guideErrors.
  return stop.guide.walks
    .filter((walk) => isRecord(walk) && (walk.to === STOP_END) !== (walk.from === STOP_END))
    .map((walk) => [id, (walk as Raw).to === STOP_END ? "to" : "from"]);
}

function walkDirections(stops: unknown[]): WalkDirections {
  const directions: WalkDirections = { toStop: new Set(), fromStop: new Set() };
  for (const [id, way] of stops.flatMap(walkDirectionOf)) (way === "to" ? directions.toStop : directions.fromStop).add(id);
  return directions;
}

interface WalkDirections {
  toStop: Set<string>;
  fromStop: Set<string>;
}

interface SequenceContext {
  knownServiceIds: ReadonlySet<string>;
  stopIds: ReadonlySet<string>;
  walks: WalkDirections;
}

// WHY: `seen` is per route sequence: a stop may appear once in each.
interface RouteContext extends SequenceContext {
  seen: Set<string>;
}

function stopRefErrors(entry: Raw, at: string, { stopIds, walks, seen }: RouteContext): string[] {
  const errors: string[] = [];
  if (typeof entry.stopId !== "string" || !stopIds.has(entry.stopId)) errors.push(`${at}: unknown stop id ${JSON.stringify(entry.stopId)}`);
  else if (seen.has(entry.stopId)) errors.push(`${at}: stop ${entry.stopId} appears twice`);
  else seen.add(entry.stopId);
  // WHY: a walk is drawn one way; a stop used the other way would show riders the wrong arrow.
  if (entry.action === "alight" && walks.toStop.has(entry.stopId as string)) {
    errors.push(`${at}: stop ${String(entry.stopId)} has a walk to the stop (boarding), but this sequence alights there`);
  }
  if (entry.action === "board" && walks.fromStop.has(entry.stopId as string)) {
    errors.push(`${at}: stop ${String(entry.stopId)} has a walk from the stop (alighting), but this sequence boards there`);
  }
  return errors;
}

function nameErrors(entry: Raw, at: string, context: RouteContext): string[] {
  if (("stopId" in entry) === ("label" in entry)) return [`${at}: needs exactly one of stopId and label`];
  if ("stopId" in entry) return stopRefErrors(entry, at, context);
  const labelError = i18nError(entry.label);
  return labelError ? [`${at}: label ${labelError}`] : [];
}

function sequenceStopErrors(entry: unknown, at: string, context: RouteContext): string[] {
  if (!isRecord(entry)) return [`${at}: must be an object`];
  const errors = nameErrors(entry, at, context);
  for (const field of ["note", "detail"] as const) {
    const error = field in entry ? i18nError(entry[field]) : null;
    if (error) errors.push(`${at}: ${field} ${error}`);
  }
  if (entry.action !== "board" && entry.action !== "alight") errors.push(`${at}: action must be "board" or "alight"`);
  if (entry.timing !== "scheduled" && entry.timing !== "estimated") errors.push(`${at}: timing must be "scheduled" or "estimated"`);
  return errors;
}

// WHY: the run departs from its first stop, and a run nobody gets off is not one.
function runShapeErrors(sequence: unknown[], at: string): string[] {
  const errors: string[] = [];
  const first = sequence[0];
  if (isRecord(first) && first.action !== "board") errors.push(`${at}: the first stop must be a boarding stop`);
  if (!sequence.some((entry) => isRecord(entry) && entry.action === "alight")) errors.push(`${at}: must have at least one alighting stop`);
  return errors;
}

function routeSequenceErrors(sequence: unknown, at: string, context: SequenceContext): string[] {
  if (!Array.isArray(sequence) || sequence.length < 2) return [`${at}: must list at least two stops`];
  const routeContext = { ...context, seen: new Set<string>() };
  const errors = sequence.flatMap((entry, i) => sequenceStopErrors(entry, `${at}[${i}]`, routeContext));
  return [...errors, ...runShapeErrors(sequence, at)];
}

function serviceSequenceErrors(serviceId: string, byRouteType: unknown, context: SequenceContext): string[] {
  const label = `sequences ${serviceId}`;
  const errors = context.knownServiceIds.has(serviceId) ? [] : [`${label}: unknown service`];
  if (!isRecord(byRouteType) || Object.keys(byRouteType).length === 0) return [...errors, `${label}: must map route types to stop sequences`];
  for (const [routeType, sequence] of Object.entries(byRouteType)) {
    errors.push(...routeSequenceErrors(sequence, `${label}.${routeType}`, context));
  }
  return errors;
}

function etaStopErrors(entry: unknown, at: string, hasCoords: ReadonlyMap<string, boolean>): string[] {
  if (!isRecord(entry)) return [];
  if (typeof entry.stopId !== "string") return [`${at}: opted in to estimates, but is a label, not a catalog stop with coordinates`];
  return hasCoords.get(entry.stopId) === false ? [`${at}: opted in to estimates, but stop ${entry.stopId} has no coordinates`] : [];
}

function etaSequenceErrors(sequence: unknown, at: string, hasCoords: ReadonlyMap<string, boolean>): string[] {
  if (!Array.isArray(sequence)) return [`${at}: opted in to estimates but has no stop sequence`];
  const errors = sequence.length > MAX_ETA_STOPS ? [`${at}: opted in to estimates with ${sequence.length} stops, more than ${MAX_ETA_STOPS}`] : [];
  errors.push(...sequence.flatMap((entry, i) => etaStopErrors(entry, `${at}[${i}]`, hasCoords)));
  const first = sequence[0];
  if (isRecord(first) && first.timing !== "scheduled") errors.push(`${at}: opted in to estimates, but its first stop is not scheduled`);
  if (!sequence.some((entry) => isRecord(entry) && entry.timing === "estimated")) errors.push(`${at}: opted in to estimates, but has no estimated stop`);
  return errors;
}

// WHY: an opted-in sequence is sent to a directions API as one route: every stop needs coordinates, the run a
// departure to measure from and a drop-off to estimate.
function etaErrors(stops: unknown[], sequences: Raw, optIns: EtaOptIns): string[] {
  const hasCoords = new Map(stops.filter(isRecord).filter((s) => isNonBlank(s.id)).map((s) => [s.id as string, isKoreanLatLng(s.coords)]));
  return [...optIns].flatMap(([serviceId, routeTypes]) =>
    routeTypes.flatMap((routeType) => {
      const byRouteType = sequences[serviceId];
      const sequence = isRecord(byRouteType) ? byRouteType[routeType] : undefined;
      return etaSequenceErrors(sequence, `sequences ${serviceId}.${routeType}`, hasCoords);
    }),
  );
}

export function etaOptIns(serviceConfig: ServiceConfigMap): Map<string, readonly string[]> {
  return new Map(
    Object.entries(serviceConfig)
      .flatMap(([serviceId, entry]) => (entry.eta ? [[serviceId, entry.eta.routeTypes] as const] : [])),
  );
}

export function validateStopCatalog(raw: unknown, knownServiceIds: ReadonlySet<string>, optIns: EtaOptIns = new Map()): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.stops) || !isRecord(raw.sequences)) return ["bus-stops must be { stops: [], sequences: {} }"];
  const stopIds = new Set<string>();
  const errors = stopsErrors(raw.stops, stopIds);
  const context = { knownServiceIds, stopIds, walks: walkDirections(raw.stops) };
  for (const [serviceId, byRouteType] of Object.entries(raw.sequences)) {
    errors.push(...serviceSequenceErrors(serviceId, byRouteType, context));
  }
  return [...errors, ...etaErrors(raw.stops, raw.sequences, optIns)];
}

// WHY: a malformed root or stop is validateStopCatalog's to report; this names only the station a well-formed stop is at.
export function subwayStationErrors(raw: unknown, stationIds: ReadonlySet<string>): string[] {
  const stops = isRecord(raw) && Array.isArray(raw.stops) ? raw.stops : [];
  return stops.flatMap((stop) => {
    if (!isRecord(stop) || !isNonBlank(stop.id) || !("subwayStationId" in stop)) return [];
    const value = stop.subwayStationId;
    if (typeof value !== "string") return [`stop ${stop.id}: subwayStationId must be a station slug, not ${JSON.stringify(value)}`];
    return stationIds.has(value) ? [] : [`stop ${stop.id}: subwayStationId "${value}" is not a served subway station`];
  });
}

interface BusStopsIssue {
  path: Array<string | number>;
  message: string;
}

/** WHY: what the checked-out code serves, which a push is checked against. */
interface BusStopsCheckContext {
  knownServiceIds: ReadonlySet<string>;
  optIns: EtaOptIns;
  stationIds: ReadonlySet<string>;
  laneStrategies: LaneStrategies;
}

interface BusStopsReference {
  dataset: "subwayStations" | "busServices";
  id: string;
  path: Array<string | number>;
}

const STOP_LABEL = /^stop (\S+): /;
const STOP_INDEX_LABEL = /^stops\[(\d+)\]/;
const SEQUENCE_LABEL = /^sequences ([^.\s:[]+)(?:\.([^\s:[]+))?(?:\[(\d+)\])?/;

// WHY: the catalog checks label each issue ("stop <id>", "sequences <service>.<route type>[<index>]"); the label is
// read back into the dataset path the push report prints.
function catalogPathOf(message: string, stopIds: readonly string[]): Array<string | number> {
  const stopIndex = STOP_INDEX_LABEL.exec(message);
  if (stopIndex) return ["stops", Number(stopIndex[1])];
  const [, stopId] = STOP_LABEL.exec(message) ?? [];
  if (stopId !== undefined) return ["stops", message.endsWith(": duplicate id") ? stopIds.lastIndexOf(stopId) : stopIds.indexOf(stopId)];
  const [, serviceId, routeType, index] = SEQUENCE_LABEL.exec(message) ?? [];
  if (serviceId === undefined) return [];
  return ["sequences", serviceId, ...(routeType === undefined ? [] : [routeType]), ...(index === undefined ? [] : [Number(index)])];
}

// WHY: the tool keeps one issue per path (scripts/lib/datasets/checks.js), so the messages of one path are one issue.
function joinedByPath(issues: readonly BusStopsIssue[]): BusStopsIssue[] {
  const byPath = new Map<string, BusStopsIssue>();
  for (const { path, message } of issues) {
    const earlier = byPath.get(JSON.stringify(path));
    byPath.set(JSON.stringify(path), { path, message: earlier ? `${earlier.message}; ${message}` : message });
  }
  return [...byPath.values()];
}

function catalogIssues(data: BusStopsData, { knownServiceIds, optIns, stationIds }: BusStopsCheckContext): BusStopsIssue[] {
  const stopIds = data.stops.map((stop) => stop.id);
  const issues = validateStopCatalog(data, knownServiceIds, optIns).map((message) => ({ path: catalogPathOf(message, stopIds), message }));
  const stationIssues = subwayStationErrors(data, stationIds).map((message) => ({ path: [...catalogPathOf(message, stopIds), "subwayStationId"], message }));
  return joinedByPath([...issues, ...stationIssues]);
}

// WHY: a strategy only travels with an estimated sequence: one the code opts in and the data holds.
function laneStrategyIssues({ sequences }: BusStopsData, { optIns, laneStrategies }: BusStopsCheckContext): BusStopsIssue[] {
  return Object.entries(laneStrategies).flatMap(([serviceId, byRouteType]) =>
    Object.keys(byRouteType)
      .filter((routeType) => !(optIns.get(serviceId)?.includes(routeType) && sequences[serviceId]?.[routeType]))
      .map((routeType) => ({
        path: ["sequences", serviceId, routeType],
        message: `"${serviceId} ${routeType}" has a travel strategy in src/bus/eta/lane/bus-eta-lane.constants.ts, but this data does not estimate it`,
      })),
  );
}

function passThroughMismatchOf(stopId: string | null, index: number): string | null {
  if ((stopId === null) === isHsscPassThrough(index)) return null;
  const source = "(isHsscPassThrough in src/bus/bus.rules.ts)";
  return stopId === null ? `is null, but the HSSC estimates count position ${index} as a stop ${source}` : `names the stop "${stopId}" at position ${index}, which the HSSC estimates pass through ${source}`;
}

function hsscLineIssues({ stops, hssc }: BusStopsData): BusStopsIssue[] {
  const stopIds = new Set(stops.map((stop) => stop.id));
  const positionByStopId = new Map<string, number>();
  const last = hssc.stations.length - 1;
  return hssc.stations.flatMap((station, index) => {
    const at = ["hssc", "stations", index];
    const issues: BusStopsIssue[] = [];
    if (station.isFirstStation && index !== 0) issues.push({ path: [...at, "isFirstStation"], message: "only the first position may be the first station" });
    if (station.isLastStation && index !== last) issues.push({ path: [...at, "isLastStation"], message: "only the last position may be the last station" });
    const { stopId } = station;
    const passThroughIssue = passThroughMismatchOf(stopId, index);
    if (passThroughIssue !== null) return [...issues, { path: [...at, "stopId"], message: passThroughIssue }];
    if (stopId === null) return issues;
    const earlier = positionByStopId.get(stopId);
    if (!stopIds.has(stopId)) issues.push({ path: [...at, "stopId"], message: `names the stop "${stopId}", which the dataset's stops do not hold` });
    else if (earlier !== undefined) issues.push({ path: [...at, "stopId"], message: `names the stop "${stopId}", which position ${earlier} names too` });
    else positionByStopId.set(stopId, index);
    return issues;
  });
}

function aliasIssues({ stops }: BusStopsData): BusStopsIssue[] {
  const claimedAt = new Map<string, string>();
  return stops.flatMap((stop, stopIndex) =>
    (stop.arsIds ?? []).flatMap((arsId, aliasIndex) => {
      const path = ["stops", stopIndex, "arsIds", aliasIndex];
      const earlier = claimedAt.get(arsId);
      if (earlier === undefined) claimedAt.set(arsId, path.join("."));
      return earlier === undefined ? [] : [{ path, message: `ARS number ${arsId} is aliased by ${earlier} too` }];
    }),
  );
}

// WHY: push checks the snapshot cannot serve past; the read skips the timetable cross-check, which needs another database.
export function storedLineAndAliasErrors(data: BusStopsData): string[] {
  return [...hsscLineIssues(data), ...aliasIssues(data)].map(({ path, message }) => `${path.join(".")}: ${message}`);
}

function overlayIssues({ topis = {} }: BusStopsData, { stationIds }: BusStopsCheckContext): BusStopsIssue[] {
  return Object.entries(topis).flatMap(([arsId, overlay]) => {
    const { subwayStationId } = overlay;
    if (subwayStationId === undefined || stationIds.has(subwayStationId)) return [];
    return [{ path: ["topis", arsId, "subwayStationId"], message: `"${subwayStationId}" is not a served subway station` }];
  });
}

/** WHY: every check a bus-stops push runs after its schema, each issue at its path. */
export function toBusStopsIssues(data: BusStopsData, context: BusStopsCheckContext): BusStopsIssue[] {
  return [...catalogIssues(data, context), ...laneStrategyIssues(data, context), ...hsscLineIssues(data), ...aliasIssues(data), ...overlayIssues(data, context)];
}

/** WHY: what the dataset names in the code-held sources: each stop's and overlay entry's subway station, each sequence's service. */
export function busStopsReferences({ stops, sequences, topis = {} }: BusStopsData): BusStopsReference[] {
  const station = (id: string | undefined, path: Array<string | number>): BusStopsReference[] => (id === undefined ? [] : [{ dataset: "subwayStations", id, path }]);
  return [
    ...stops.flatMap((stop, index) => station(stop.subwayStationId, ["stops", index, "subwayStationId"])),
    ...Object.entries(topis).flatMap(([arsId, overlay]) => station(overlay.subwayStationId, ["topis", arsId, "subwayStationId"])),
    ...Object.keys(sequences).map((serviceId): BusStopsReference => ({ dataset: "busServices", id: serviceId, path: ["sequences", serviceId] })),
  ];
}
