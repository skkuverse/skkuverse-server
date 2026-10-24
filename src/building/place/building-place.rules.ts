import type { Campus, SkkuId } from "../building.types";
import type { PlaceBuilding, PlaceSpace } from "./building-place.document";
import type { PlaceLexicon } from "./building-place.schema";
import type { IndexedPlace, IndexedSpace, PlaceAlias, PlaceIndex, PlacePatterns } from "./building-place.types";

interface PlaceSkkumap { buildings: readonly PlaceBuilding[]; spaces: readonly PlaceSpace[] }

interface AliasDraft { text: string; targets: Set<string>; isWeak: boolean; needsBoundary: boolean; isWord: boolean }

// EVIDENCE: in the 2026-10-24 skkumap export every building with a prefix starts at least this share of its spaceCds with it.
const MIN_PREFIX_SHARE = 0.8;
const MIN_ALIAS_LENGTH = 2;
const MIN_OFFICE_KEY_LENGTH = 3;
const MIN_VARIANT_LENGTH = 3;

export function toMatchText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function toWordText(text: string): string {
  const words = text.normalize("NFKC").toLowerCase().replaceAll("&", " and ").replace(/[^a-z0-9가-힣]+/g, " ").trim();
  return ` ${words} `;
}

export function isWordAlias(text: string): boolean {
  return /^[A-Za-z0-9 &'.-]+$/.test(text);
}

// WHY: a notice may name a part on its own: `수선관(별관)` gives `수선관` and `별관`.
export function toNameParts(name: string): string[] {
  return [name.replace(/\(.*?\)/g, ""), ...[...name.matchAll(/\((.*?)\)/g)].map((m) => m[1] ?? "")];
}

export function toPatternOf(phrases: readonly string[]): RegExp {
  return new RegExp(phrases.map((p) => `(?:${p})`).join("|"), "iu");
}

function toFloorCode(floor: string): string {
  const storey = /^(지하)?(\d+)층$/.exec(floor);
  return storey ? `${storey[1] ? "B" : ""}${storey[2]}` : floor;
}

function toRoomKeys(name: string): string[] {
  const pieces = [name, ...toNameParts(name)];
  const keys = [...pieces, ...pieces.flatMap((p) => p.split(/[/,․·]/))].map(toMatchText);
  return [...new Set(keys.filter((k) => k.length >= MIN_ALIAS_LENGTH && !/\d{5,}/.test(k)))];
}

function toIndexedSpaces(spaces: readonly PlaceSpace[]): IndexedSpace[] {
  return spaces.flatMap(({ spaceCd, buildNo, campus, floor, name }) => {
    if (!spaceCd) return [];
    const roomName = name.ko.trim();
    return [{ spaceCd, buildNo, campus, floor: toFloorCode(floor.ko), name: roomName, roomKeys: toRoomKeys(roomName) }];
  });
}

function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
}

function toListedPlaces(buildings: readonly PlaceBuilding[], lexicon: PlaceLexicon): { places: IndexedPlace[]; unpinned: SkkuId[] } {
  const places: IndexedPlace[] = [];
  const unpinned: SkkuId[] = [];
  for (const { _id, buildNo, campus, name } of buildings) {
    const slug = buildNo ? null : (lexicon.facilitySlugs[String(_id)] ?? null);
    if (!buildNo && !slug) unpinned.push(_id);
    else places.push({ key: buildNo ?? `${campus}:${slug}`, campus, name: name.ko, buildNo, slug });
  }
  return { places, unpinned };
}

// QUIRK(skku): some buildings are listed only through their spaces (`E-하우스`), named by the spaces' buildingName.
function toSpaceOnlyPlaces(spaces: readonly PlaceSpace[], knownKeys: ReadonlySet<string>): IndexedPlace[] {
  const places = new Map<string, IndexedPlace>();
  for (const { buildNo, campus, buildingName } of spaces) {
    if (!knownKeys.has(buildNo) && !places.has(buildNo)) places.set(buildNo, { key: buildNo, campus, name: buildingName?.ko ?? buildNo, buildNo, slug: null });
  }
  return [...places.values()];
}

function toPlaces({ buildings, spaces }: PlaceSkkumap, lexicon: PlaceLexicon): { places: IndexedPlace[]; unpinned: SkkuId[] } {
  const { places, unpinned } = toListedPlaces(buildings, lexicon);
  const extras = lexicon.extraFacilities.map(({ campus, slug, name }) => ({ key: `${campus}:${slug}`, campus, name: name.ko, buildNo: null, slug }));
  const listed = [...places, ...extras];
  return { places: [...listed, ...toSpaceOnlyPlaces(spaces, new Set(listed.map((p) => p.key)))], unpinned };
}

function toPrefix(buildNo: string, spaces: readonly IndexedSpace[]): string | null {
  const tail = buildNo.slice(1);
  const candidates = /^\d+$/.test(tail) ? [String(Number(tail)), tail, buildNo] : [buildNo];
  const isShared = (prefix: string) => spaces.filter((s) => s.spaceCd.startsWith(prefix)).length >= MIN_PREFIX_SHARE * spaces.length;
  return candidates.find(isShared) ?? null;
}

function toNameAliases(names: ReadonlyArray<[string, string]>, lexicon: PlaceLexicon): Array<[string, string[], boolean]> {
  const weakNames = new Set(lexicon.weakNames.map(toMatchText));
  const notAliases = new Set(lexicon.notAliases.map(toMatchText));
  const keyByFullName = new Map(names.map(([name, key]) => [toMatchText(name), key]));
  const owners = groupBy(names.flatMap(([name, key]) => toNameParts(name).map((part) => [toMatchText(part), key] as const)), ([part]) => part);
  const isOwnPart = (part: string, key: string) =>
    part.length >= MIN_VARIANT_LENGTH && new Set(owners.get(part)?.map(([, k]) => k)).size === 1 && (keyByFullName.get(part) ?? key) === key;
  return names.flatMap(([name, key]) => {
    const variants = [name, ...toNameParts(name).filter((part) => isOwnPart(toMatchText(part), key))];
    const kept = [...new Set(variants)].filter((v) => !notAliases.has(toMatchText(v)) && toMatchText(v).length >= MIN_ALIAS_LENGTH);
    return kept.map((v): [string, string[], boolean] => [v, [key], weakNames.has(toMatchText(v))]);
  });
}

function toSpaceBuildingNames(spaces: readonly PlaceSpace[]): Array<[string, string]> {
  const nameByBuildNo = new Map<string, string>();
  for (const { buildNo, buildingName } of spaces) if (buildingName && !nameByBuildNo.has(buildNo)) nameByBuildNo.set(buildNo, buildingName.ko);
  return [...nameByBuildNo].map(([buildNo, name]) => [name, buildNo]);
}

function toAliases(places: readonly IndexedPlace[], spaceNames: ReadonlyArray<[string, string]>, lexicon: PlaceLexicon): { aliases: PlaceAlias[]; dropped: string[] } {
  const keys = new Set(places.map((p) => p.key));
  const drafts = new Map<string, AliasDraft>();
  const add = (alias: string, targets: readonly string[], flags: { weak?: boolean; boundary?: boolean }) => {
    const isWord = isWordAlias(alias);
    const text = isWord ? toWordText(alias) : toMatchText(alias);
    if (text.trim().length < MIN_ALIAS_LENGTH) return;
    const draft = drafts.get(`${isWord}|${text}`) ?? { text, targets: new Set(), isWeak: false, needsBoundary: false, isWord };
    targets.forEach((t) => draft.targets.add(t));
    draft.isWeak ||= !!flags.weak;
    draft.needsBoundary ||= !!flags.boundary;
    drafts.set(`${isWord}|${text}`, draft);
  };
  for (const [alias, targets, weak] of toNameAliases([...places.map((p): [string, string] => [p.name, p.key]), ...spaceNames], lexicon)) add(alias, targets, { weak });
  for (const { campus, slug, aliases } of lexicon.extraFacilities) aliases.forEach((alias) => add(alias, [`${campus}:${slug}`], {}));
  const dropped = lexicon.buildingAliases.filter((a) => !a.targets.every((t) => keys.has(t))).map((a) => a.alias);
  for (const { alias, targets, weak, boundary } of lexicon.buildingAliases) if (!dropped.includes(alias)) add(alias, targets, { weak, boundary });
  const aliases = [...drafts.values()].map((d) => ({ ...d, targets: [...d.targets].sort() }));
  return { aliases: aliases.sort((a, b) => b.text.trim().length - a.text.trim().length || (a.text < b.text ? -1 : 1)), dropped };
}

function toOfficeSpaces(spaces: readonly IndexedSpace[], lexicon: PlaceLexicon): Map<string, IndexedSpace[]> {
  const suffix = new RegExp(lexicon.officeSuffix, "u");
  const generic = new Set(lexicon.genericOffices.map(toMatchText));
  const isOffice = (key: string) => key.length >= MIN_OFFICE_KEY_LENGTH && suffix.test(key) && !generic.has(key);
  const offices = groupBy(spaces.flatMap((s) => s.roomKeys.filter(isOffice).map((key) => ({ key, space: s }))), (o) => o.key);
  const officeSpaces = new Map<string, IndexedSpace[]>();
  for (const [key, rows] of offices) {
    if (new Set(rows.map((r) => r.space.buildNo)).size <= lexicon.officeMaxBuildings) officeSpaces.set(key, rows.map((r) => r.space));
  }
  return officeSpaces;
}

function toPatterns(lexicon: PlaceLexicon): PlacePatterns {
  const campusPhrases = (Object.entries(lexicon.campusPhrases) as Array<[Campus, string[]]>).map(([campus, phrases]) => ({ campus, pattern: toPatternOf(phrases) }));
  return {
    campusPhrases,
    areas: lexicon.campusAreas.map(({ alias, campus }) => ({ text: isWordAlias(alias) ? toWordText(alias) : toMatchText(alias), isWord: isWordAlias(alias), campus })),
    boardCampusBySource: new Map(Object.entries(lexicon.boardCampus)),
    boardBuildNoBySource: new Map(Object.entries(lexicon.boardBuilding)),
    skkuMarker: toPatternOf(lexicon.skkuMarkers),
    online: toPatternOf(lexicon.online),
    offcampusStrong: toPatternOf(lexicon.offcampusStrong),
    offcampusPlace: toPatternOf(lexicon.offcampusPlace),
    offcampusWeak: toPatternOf(lexicon.offcampusWeak),
    notPlace: toPatternOf(lexicon.notPlace),
  };
}

export function toPlaceIndex(skkumap: PlaceSkkumap, lexicon: PlaceLexicon): PlaceIndex {
  const { places, unpinned } = toPlaces(skkumap, lexicon);
  const spaces = toIndexedSpaces(skkumap.spaces);
  const spacesByCd = groupBy(spaces, (s) => s.spaceCd.toUpperCase());
  const spacesByBuildNo = groupBy(spaces, (s) => s.buildNo);
  const prefixByBuildNo = new Map([...spacesByBuildNo].flatMap(([buildNo, group]) => {
    const prefix = toPrefix(buildNo, group);
    return prefix === null ? [] : [[buildNo, prefix] as const];
  }));
  const { aliases, dropped } = toAliases(places, toSpaceBuildingNames(skkumap.spaces), lexicon);
  const roomAliases = lexicon.roomAliases.map((r) => ({ text: toMatchText(r.alias), alias: r.alias, spaces: (spacesByCd.get(r.spaceCd.toUpperCase()) ?? []).filter((s) => s.campus === r.campus) }));
  return {
    placeByKey: new Map(places.map((p) => [p.key, p])),
    spacesByCd,
    spacesByBuildNo,
    prefixByBuildNo,
    aliases,
    officeSpacesByKey: toOfficeSpaces(spaces, lexicon),
    roomAliases: roomAliases.flatMap((r) => (r.spaces.length === 1 && r.spaces[0] ? [{ text: r.text, space: r.spaces[0] }] : [])).sort((a, b) => b.text.length - a.text.length),
    patterns: toPatterns(lexicon),
    unpinnedFacilities: unpinned,
    droppedAliases: [...dropped, ...roomAliases.filter((r) => r.spaces.length !== 1).map((r) => r.alias)],
  };
}
