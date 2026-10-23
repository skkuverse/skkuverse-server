/**
 * The directions (방면) each realtime group of `/bus/config` and `/bus/config/:groupId` serves since 2026-10-23, for a
 * test that pinned a body served before them: `withLineDirections` inserts exactly them into a pinned group (the
 * screen's `directions` right after `stations`, each station's `directionId` right after `stationNumber`), and
 * `withoutLineDirections` removes them from every group of a body, so a test asserts both the new body and that
 * nothing else changed.
 *
 * The HSSC line's are the owner's split, 하교 at positions 0 to 5 and 등교 at 6 to 10. A Jongno route's are TOPIS's,
 * joined from the stored route lines of fixtures/jongro-route-paths.json (directions captured 2026-10-23), which match
 * fixtures/jongro-registry-routes.json station for station; with no stored line a route serves none and every station
 * null (`hasStoredLines: false`, the characterization tests' empty `jongro_route_paths`).
 */
type Lang = "ko" | "en" | "zh";
type Station = Record<string, unknown>;
type Group = { id: string; screen: { stations?: Station[] } & Record<string, unknown> } & Record<string, unknown>;
interface Direction {
  id: string;
  label: string;
  fromIndex: number;
  toIndex: number;
}

const HSSC_LABELS: Record<Lang, [string, string]> = { ko: ["하교", "등교"], en: ["From campus", "To campus"], zh: ["放学", "上学"] };

// [terminal TOPIS id, terminal, fromIndex, toIndex] per direction, in line order.
const JONGRO_DIRECTIONS: Record<string, Array<[string, string, number, number]>> = {
  jongro02: [
    ["100900116", "종각역YMCA", 0, 12],
    ["100900204", "성균관대학교", 13, 26],
  ],
  jongro07: [
    ["100900043", "이화사거리", 0, 12],
    ["100900220", "성균관대운동장", 13, 21],
  ],
  jongro08: [
    ["100900191", "종로5가", 0, 15],
    ["100900040", "명륜3가", 16, 30],
  ],
};

const towards = (terminal: string, lang: Lang): string => ({ ko: `${terminal} 방면`, en: `To ${terminal}`, zh: `${terminal} 方向` })[lang];

/** The directions of a realtime group, by its id; undefined for a schedule group. */
export function lineDirectionsOf(groupId: string, lang: Lang, { hasStoredLines = true } = {}): Direction[] | undefined {
  if (groupId === "hssc") {
    const [from, to] = HSSC_LABELS[lang];
    return [
      { id: "fromCampus", label: from, fromIndex: 0, toIndex: 5 },
      { id: "toCampus", label: to, fromIndex: 6, toIndex: 10 },
    ];
  }
  const jongro = JONGRO_DIRECTIONS[groupId];
  if (jongro === undefined) return undefined;
  return hasStoredLines ? jongro.map(([id, terminal, fromIndex, toIndex]) => ({ id, label: towards(terminal, lang), fromIndex, toIndex })) : [];
}

const insertAfter = (record: Record<string, unknown>, key: string, added: [string, unknown]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).flatMap((entry) => (entry[0] === key ? [entry, added] : [entry])));

/** A pinned group with its directions inserted; a schedule group as it was. */
export function withLineDirections<T>(pinned: T, lang: Lang, options: { hasStoredLines?: boolean } = {}): T {
  const group = structuredClone(pinned) as unknown as Group;
  const directions = lineDirectionsOf(group.id, lang, options);
  if (directions === undefined || group.screen.stations === undefined) return group as unknown as T;
  const idAt = (index: number) => directions.find((direction) => direction.fromIndex <= index && index <= direction.toIndex)?.id ?? null;
  const stations = group.screen.stations.map((station, index) => insertAfter(station, "stationNumber", ["directionId", idAt(index)]));
  const screen = insertAfter({ ...group.screen, stations }, "stations", ["directions", directions]);
  return { ...group, screen } as unknown as T;
}

/** A body (a group or `{ groups }`) with every screen's `directions` and every station's `directionId` removed. */
export function withoutLineDirections<T>(body: T): T {
  const copy = structuredClone(body) as unknown as { groups?: Group[] } & Partial<Group>;
  const groups = copy.groups ?? [copy as Group];
  for (const group of groups) {
    if (!group.screen) continue;
    delete group.screen.directions;
    if (group.screen.stations) group.screen.stations = group.screen.stations.map(({ directionId: _directionId, ...station }) => station);
  }
  return copy as unknown as T;
}
