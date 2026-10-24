import { escapeRegex } from "../../../shared/regex.util";
import { isCampus } from "../../building.rules";
import type { Campus } from "../../building.types";
import { toMatchText, toWordText } from "../building-place.rules";
import type { IndexedSpace, PlaceAlias, PlaceIndex, ResolvedPlace, UnresolvedReason } from "../building-place.types";
import type { PlaceMention } from "./building-place-resolve.types";
import {
  FLOOR_PATTERNS,
  LINK_PATTERN,
  MIN_ROOM_CODE_LENGTH,
  NSC_BUILDING_DIGIT,
  NSC_BUILDING_NUMBER_PATTERN,
  ROOM_CODE_PATTERN,
  ROOM_NUMBER_PATTERN,
  SKKU_NAME_PATTERN,
} from "./building-place-resolve.constants";

interface PlaceReading {
  text: string;
  body: string;
  hasLink: boolean;
  isOffcampusWord: boolean;
  textCampus: Campus | null;
  saysSkku: boolean;
  hint: Campus | null;
  boardCampus: Campus | null;
  boardBuildNo: string | null;
  codeHits: IndexedSpace[][];
  floor: string | null;
  numbers: string[];
  rest: string;
}

interface BuildingQuery { keys: readonly string[]; remainder: string }

const MIN_ROOM_KEY_LENGTH = 3;

const unresolved = (reason: UnresolvedReason, campus: Campus | null = null): ResolvedPlace => ({ kind: "unresolved", reason, campus });

const UNKNOWN = unresolved("unknown");

const toSpacePlace = ({ campus, spaceCd, buildNo }: IndexedSpace): ResolvedPlace => ({ kind: "space", campus, spaceCd, buildNo });

const unique = <T>(rows: readonly T[]): T[] => [...new Set(rows)];

function toKeyPlace(key: string, index: PlaceIndex): ResolvedPlace {
  const place = index.placeByKey.get(key);
  if (!place) return UNKNOWN;
  if (place.buildNo) return { kind: "building", campus: place.campus, buildNo: place.buildNo };
  return { kind: "facility", campus: place.campus, slug: place.slug ?? "" };
}

// WHY: several candidates are never guessed between; the campus is kept when they share one, for a list-only entry.
function toUndecided(campuses: readonly Campus[]): ResolvedPlace {
  const shared = unique(campuses);
  return unresolved("unknown", shared.length === 1 ? (shared[0] ?? null) : null);
}

function campusOfKey(key: string, index: PlaceIndex): Campus | null {
  return index.placeByKey.get(key)?.campus ?? null;
}

function pickCampus<T>(rows: readonly T[], campusOf: (row: T) => Campus | null, reading: PlaceReading): readonly T[] {
  if (unique(rows.map(campusOf)).length < 2) return rows;
  for (const campus of [reading.hint, reading.boardCampus]) {
    const picked = campus ? rows.filter((row) => campusOf(row) === campus) : [];
    if (picked.length > 0) return picked;
  }
  return rows;
}

function readFloor(text: string): { floor: string | null; rest: string } {
  let floor: string | null = null;
  let rest = text;
  for (const { pattern, basement } of FLOOR_PATTERNS) {
    const floorNumber = [...rest.matchAll(pattern)][0]?.[1];
    if (floorNumber !== undefined && floor === null) floor = `${basement ? "B" : ""}${floorNumber}`;
    rest = rest.replace(pattern, " ");
  }
  return { floor, rest };
}

function readCodes(body: string, index: PlaceIndex): { codeHits: IndexedSpace[][]; rest: string } {
  const codeHits: IndexedSpace[][] = [];
  let rest = body;
  for (const [, token = ""] of body.matchAll(ROOM_CODE_PATTERN)) {
    const spaces = index.spacesByCd.get(token.toUpperCase());
    if (token.length < MIN_ROOM_CODE_LENGTH || !spaces) continue;
    codeHits.push([...spaces]);
    rest = rest.replaceAll(token, " ");
  }
  const roomAlias = index.roomAliases.find((alias) => toMatchText(body).includes(alias.text));
  if (roomAlias) codeHits.push([roomAlias.space]);
  return { codeHits, rest };
}

function readPlace(text: string, mention: PlaceMention, index: PlaceIndex): PlaceReading {
  const { patterns } = index;
  const campuses = patterns.campusPhrases.filter(({ pattern }) => pattern.test(text)).map(({ campus }) => campus);
  const textCampus = unique(campuses).length === 1 ? (campuses[0] ?? null) : null;
  const body = text.replace(LINK_PATTERN, " ");
  const { codeHits, rest: uncoded } = readCodes(body, index);
  const { floor, rest: unfloored } = readFloor(uncoded);
  const numbers = [...unfloored.matchAll(ROOM_NUMBER_PATTERN)].map((m) => m[1] ?? m[2] ?? "");
  const source = mention.source ?? "";
  const saysSkku = textCampus !== null || patterns.skkuMarker.test(text);
  return {
    text,
    body,
    hasLink: body !== text,
    isOffcampusWord: !saysSkku && patterns.offcampusWeak.test(body),
    textCampus,
    saysSkku,
    hint: isCampus(mention.campusHint) ? mention.campusHint : null,
    boardCampus: patterns.boardCampusBySource.get(source) ?? null,
    boardBuildNo: patterns.boardBuildNoBySource.get(source) ?? null,
    codeHits,
    floor,
    numbers,
    rest: unfloored.replace(ROOM_NUMBER_PATTERN, " "),
  };
}

const overlaps = (span: readonly [number, number], taken: ReadonlyArray<readonly [number, number]>) =>
  taken.some(([start, end]) => span[0] < end && start < span[1]);

function aliasSpans(alias: PlaceAlias, text: string): Array<[number, number]> {
  if (alias.isWord) {
    const word = new RegExp(`(?<= )${escapeRegex(alias.text.trim())}(?= )`, "g");
    return [...toWordText(text).matchAll(word)].map((m): [number, number] => [m.index, m.index + m[0].length]);
  }
  const matchText = toMatchText(text);
  const spans: Array<[number, number]> = [];
  for (let at = matchText.indexOf(alias.text); at >= 0; at = matchText.indexOf(alias.text, at + 1)) spans.push([at, at + alias.text.length]);
  const startsWord = /^[a-z]/.test(alias.text);
  const needsStart = alias.needsBoundary && !new RegExp(`(?<![가-힣])${escapeRegex(alias.text)}`, "u").test(text.normalize("NFKC"));
  return needsStart ? [] : spans.filter(([start]) => !(startsWord && start > 0 && /[a-z]/.test(matchText[start - 1] ?? "")));
}

// WHY: longest alias first, and no two hits share a character: `수선관 별관` names the annex, not the hall too.
function matchAliases(text: string, index: PlaceIndex, isWeak: boolean): PlaceAlias[] {
  const taken = { word: [] as Array<[number, number]>, match: [] as Array<[number, number]> };
  const hits: PlaceAlias[] = [];
  for (const alias of index.aliases.filter((a) => a.isWeak === isWeak)) {
    const spans = taken[alias.isWord ? "word" : "match"];
    for (const span of aliasSpans(alias, text).filter((s) => !overlaps(s, spans))) {
      spans.push(span);
      hits.push(alias);
    }
  }
  return hits;
}

// WHY: a hit another hit narrows is dropped, so `제1공학관 21동` names wing 221 and not all three wings.
function toMostSpecific(targetSets: ReadonlyArray<readonly string[]>): string[] {
  const isNarrowedBy = (wide: readonly string[], narrow: readonly string[]) => narrow.length < wide.length && narrow.every((k) => wide.includes(k));
  return unique(targetSets.filter((set) => !targetSets.some((other) => isNarrowedBy(set, other))).flat());
}

function nscBuildingNumbers(rest: string, index: PlaceIndex): string[][] {
  return [...rest.matchAll(NSC_BUILDING_NUMBER_PATTERN)].map((m) => `${NSC_BUILDING_DIGIT}${m[1]}`).filter((k) => index.placeByKey.has(k)).map((k) => [k]);
}

function toRemainder(reading: PlaceReading, hits: readonly PlaceAlias[], index: PlaceIndex): string {
  let remainder = toMatchText(reading.rest);
  for (const alias of hits) if (!alias.isWord) remainder = remainder.replaceAll(alias.text, "");
  for (const { pattern } of index.patterns.campusPhrases) {
    // WHY: as the prototype the labelled set was measured on: a campus phrase restarts from the whole rest.
    if (pattern.test(reading.rest)) remainder = toMatchText(reading.rest.replace(new RegExp(pattern.source, `${pattern.flags}g`), " "));
  }
  return remainder.replace(SKKU_NAME_PATTERN, "");
}

function roomNameScore(space: IndexedSpace, remainder: string): number {
  const lengths = space.roomKeys.filter((key) => (key.length >= MIN_ROOM_KEY_LENGTH && remainder.includes(key)) || key === remainder).map((key) => key.length);
  return Math.max(0, ...lengths);
}

function roomNameHits(query: BuildingQuery, floor: string | null, index: PlaceIndex): IndexedSpace[] {
  const scored = query.keys.flatMap((key) => (index.spacesByBuildNo.get(key) ?? []).map((space) => ({ space, score: roomNameScore(space, query.remainder) })));
  const best = Math.max(0, ...scored.map((s) => s.score));
  const hits = best > 0 ? scored.filter((s) => s.score === best).map((s) => s.space) : [];
  return floor ? hits.filter((s) => s.floor === floor) : hits;
}

function roomNumberHits(keys: readonly string[], reading: PlaceReading, index: PlaceIndex): IndexedSpace[] {
  const hits = unique(
    keys.flatMap((key) => {
      const prefix = index.prefixByBuildNo.get(key);
      if (prefix === undefined) return [];
      const codes = reading.numbers.flatMap((n) => [`${prefix}${n}`, `${prefix}0${n}`, n]);
      return codes.flatMap((code) => index.spacesByCd.get(code.toUpperCase()) ?? []).filter((s) => s.buildNo === key);
    }),
  );
  const onFloor = hits.filter((s) => s.floor === reading.floor);
  return reading.floor && onFloor.length > 0 ? onFloor : hits;
}

function resolveRooms(rooms: readonly IndexedSpace[], reading: PlaceReading, index: PlaceIndex): ResolvedPlace | string[] {
  const picked = pickCampus(rooms, (s) => s.campus, reading);
  if (picked.length === 1 && picked[0]) return toSpacePlace(picked[0]);
  const keys = unique(picked.map((s) => s.buildNo as string));
  return keys.length === 1 && keys[0] ? toKeyPlace(keys[0], index) : keys;
}

function resolveBuildings(query: BuildingQuery, reading: PlaceReading, index: PlaceIndex): ResolvedPlace {
  let rooms = reading.numbers.length > 0 ? roomNumberHits(query.keys, reading, index) : [];
  if (rooms.length === 0 && query.remainder) rooms = roomNameHits(query, reading.floor, index);
  const roomKeys = rooms.length > 0 ? resolveRooms(rooms, reading, index) : [...query.keys];
  if (!Array.isArray(roomKeys)) return roomKeys;
  const keys = roomKeys.length > 1 ? pickCampus([...roomKeys].sort(), (k) => campusOfKey(k, index), reading) : roomKeys;
  if (keys.length === 1 && keys[0]) return toKeyPlace(keys[0], index);
  return toUndecided(keys.flatMap((k) => campusOfKey(k, index) ?? []));
}

function toCodeSpace(spaces: readonly IndexedSpace[], named: readonly string[], reading: PlaceReading): IndexedSpace | null {
  let candidates = named.length > 0 ? spaces.filter((s) => named.includes(s.buildNo)) : spaces;
  const onTextCampus = candidates.filter((s) => s.campus === reading.textCampus);
  if (candidates.length > 1 && onTextCampus.length > 0) candidates = onTextCampus;
  candidates = pickCampus(candidates, (s) => s.campus, reading);
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function resolveCodes(named: readonly string[], reading: PlaceReading, index: PlaceIndex): ResolvedPlace {
  const chosen = reading.codeHits.map((spaces) => toCodeSpace(spaces, named, reading));
  const spaces = unique(chosen.filter((s): s is IndexedSpace => s !== null));
  const isContradicted = reading.textCampus !== null && spaces.some((s) => s.campus !== reading.textCampus);
  if (chosen.includes(null) || isContradicted) return UNKNOWN;
  if (spaces.length === 1 && spaces[0]) return toSpacePlace(spaces[0]);
  const keys = unique(spaces.map((s) => s.buildNo as string));
  return keys.length === 1 && keys[0] ? toKeyPlace(keys[0], index) : toUndecided(spaces.map((s) => s.campus));
}

function inTextCampus(keys: readonly string[], reading: PlaceReading, index: PlaceIndex): string[] {
  return keys.filter((k) => campusOfKey(k, index) === reading.textCampus);
}

function resolveOffice(reading: PlaceReading, index: PlaceIndex): ResolvedPlace | null {
  const rest = toMatchText(reading.rest);
  const offices = [...index.officeSpacesByKey].filter(([key]) => rest.includes(key));
  const longest = Math.max(0, ...offices.map(([key]) => key.length));
  const spaces = offices.filter(([key]) => key.length === longest).flatMap(([, s]) => s);
  const found = pickCampus(reading.textCampus ? spaces.filter((s) => s.campus === reading.textCampus) : spaces, (s) => s.campus, reading);
  if (found.length === 0) return null;
  const decided = resolveRooms(found, reading, index);
  return Array.isArray(decided) ? toUndecided(found.map((s) => s.campus)) : decided;
}

function resolveCampusOnly(reading: PlaceReading, index: PlaceIndex): ResolvedPlace {
  const matchText = toMatchText(reading.text);
  const wordText = toWordText(reading.text);
  const area = index.patterns.areas.find((a) => (a.isWord ? wordText : matchText).includes(a.text));
  const campus = reading.textCampus ?? area?.campus ?? null;
  if (campus) return unresolved("campusOnly", campus);
  const tieBreak = area || reading.saysSkku ? (reading.hint ?? reading.boardCampus) : null;
  return tieBreak ? unresolved("campusOnly", tieBreak) : UNKNOWN;
}

function resolveWeakName(reading: PlaceReading, index: PlaceIndex): ResolvedPlace | null {
  if (reading.isOffcampusWord || reading.hasLink) return null;
  const hits = matchAliases(reading.body, index, true);
  const keys = toMostSpecific(hits.map((a) => a.targets));
  const named = reading.textCampus ? inTextCampus(keys, reading, index) : keys;
  return named.length > 0 ? resolveBuildings({ keys: named, remainder: toRemainder(reading, hits, index) }, reading, index) : null;
}

// WHY: on a library board a bare room name is a room of that library (`lib-nsc`: `시네마룸` is 480211); only a room counts.
function resolveBoardRoom(reading: PlaceReading, remainder: string, index: PlaceIndex): ResolvedPlace | null {
  if (!reading.boardBuildNo || !remainder) return null;
  const room = resolveBuildings({ keys: [reading.boardBuildNo], remainder }, reading, index);
  return room.kind === "space" ? room : null;
}

function resolveUnnamed(reading: PlaceReading, remainder: string, index: PlaceIndex): ResolvedPlace {
  const named = resolveWeakName(reading, index) ?? resolveOffice(reading, index) ?? resolveBoardRoom(reading, remainder, index);
  if (named) return named;
  if (reading.hasLink || index.patterns.online.test(reading.text)) return unresolved("online");
  return reading.isOffcampusWord ? unresolved("offcampus") : resolveCampusOnly(reading, index);
}

function toNamedKeys(reading: PlaceReading, hits: readonly PlaceAlias[], index: PlaceIndex): string[] | null {
  const keys = toMostSpecific([...hits.map((a) => a.targets), ...nscBuildingNumbers(reading.rest, index)]);
  const keysInCampus = reading.textCampus ? inTextCampus(keys, reading, index) : keys;
  if (keys.length > 0 && keysInCampus.length === 0) return reading.codeHits.length > 0 ? keys : null;
  return keysInCampus.length > 0 ? keysInCampus : keys;
}

function resolveReading(reading: PlaceReading, index: PlaceIndex): ResolvedPlace {
  const hits = matchAliases(reading.body, index, false);
  const named = toNamedKeys(reading, hits, index);
  if (named === null) return UNKNOWN;
  if (reading.codeHits.length > 0) return resolveCodes(named, reading, index);
  if (named.length === 0 && !reading.saysSkku && index.patterns.offcampusPlace.test(reading.body)) return unresolved("offcampus");
  const remainder = toRemainder(reading, hits, index);
  return named.length > 0 ? resolveBuildings({ keys: named, remainder }, reading, index) : resolveUnnamed(reading, remainder, index);
}

export function resolvePlace(mention: PlaceMention, index: PlaceIndex): ResolvedPlace {
  const text = mention.text.normalize("NFKC").trim();
  if (!text || index.patterns.notPlace.test(text)) return UNKNOWN;
  const reading = readPlace(text, mention, index);
  if (!reading.saysSkku && index.patterns.offcampusStrong.test(reading.body)) return unresolved("offcampus");
  return resolveReading(reading, index);
}
