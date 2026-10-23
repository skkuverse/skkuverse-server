import { t } from "../../infra/i18n";
import type { SupportedLang } from "../../infra/types";
import { HSSC_POSITION_COUNT } from "../bus.constants";
import type { RegistryStation } from "../registry/bus-registry.document";
import type { RoutePathStation } from "../route-path/bus-route-path.document";
import { HSSC_DIRECTIONS, TERMINAL_PLACEHOLDER, TOWARDS_LABEL_KEY } from "./bus-config.constants";
import type { LineDirection, LineDirections, StationDirection } from "./bus-config.types";
import type { BusGroup } from "./bus-config.wire";

interface TerminalRange {
  terminal: string;
  firstTopisId: string;
  fromIndex: number;
  toIndex: number;
}

interface TerminalDirection {
  terminal: string;
  direction: LineDirection;
}

// WHY: joined on both the sequence and the TOPIS id, so a station the registry and the route path place apart (one
// synced before the other) gets no direction rather than its neighbour's.
function joinedTerminalOf(station: RegistryStation, pathStations: readonly RoutePathStation[] | undefined): string | null {
  return pathStations?.find((candidate) => candidate.sequence === station.sequence && candidate.topisId === station.topisId)?.direction ?? null;
}

function toTerminalRanges(stations: readonly RegistryStation[], terminals: ReadonlyArray<string | null>): TerminalRange[] {
  const ranges: TerminalRange[] = [];
  stations.forEach((station, index) => {
    const terminal = terminals[index] ?? null;
    if (terminal === null) return;
    const range = ranges.find((candidate) => candidate.terminal === terminal);
    if (range) range.toIndex = index;
    else ranges.push({ terminal, firstTopisId: station.topisId, fromIndex: index, toIndex: index });
  });
  return ranges;
}

const isOneBlockEach = (ranges: readonly TerminalRange[]): boolean =>
  ranges.every((range, position) => ranges.slice(0, position).every((earlier) => earlier.toIndex < range.fromIndex));

const toTowardsLabel = (terminal: string, lang: SupportedLang): string => t(TOWARDS_LABEL_KEY, lang).replace(TERMINAL_PLACEHOLDER, terminal);

// WHY: a direction heads to the next one's first station, and the last back to the line's first.
function toTerminalDirections(ranges: readonly TerminalRange[], lang: SupportedLang): TerminalDirection[] {
  const [first] = ranges;
  if (first === undefined) return [];
  let headedTo = first.firstTopisId;
  const directions: TerminalDirection[] = [];
  for (const { terminal, firstTopisId, fromIndex, toIndex } of [...ranges].reverse()) {
    directions.unshift({ terminal, direction: { id: headedTo, label: toTowardsLabel(terminal, lang), fromIndex, toIndex } });
    headedTo = firstTopisId;
  }
  return directions;
}

// SEE: docs/reference/bus-live-api.md ("Directions"): TOPIS's terminal per station, the label flipping after the
// turnaround; each id is the TOPIS id of the terminal it heads to.
export function toJongroDirections(stations: readonly RegistryStation[], pathStations: readonly RoutePathStation[] | undefined, lang: SupportedLang): LineDirections {
  const terminals = stations.map((station) => joinedTerminalOf(station, pathStations));
  const ranges = toTerminalRanges(stations, terminals);
  const directions = toTerminalDirections(ranges, lang);
  const idByTerminal = new Map(directions.map(({ terminal, direction }) => [terminal, direction.id]));
  if (!isOneBlockEach(ranges) || new Set(idByTerminal.values()).size !== directions.length) {
    return { directions: [], directionIds: stations.map(() => null) };
  }
  return { directions: directions.map(({ direction }) => direction), directionIds: terminals.map((terminal) => (terminal === null ? null : (idByTerminal.get(terminal) ?? null))) };
}

export function toHsscDirections(lang: SupportedLang): LineDirections {
  const directions = HSSC_DIRECTIONS.map(({ id, labelKey, fromIndex, toIndex }) => ({ id, label: t(labelKey, lang), fromIndex, toIndex }));
  const directionIdAt = (index: number) => directions.find((direction) => direction.fromIndex <= index && index <= direction.toIndex)?.id ?? null;
  return { directions, directionIds: Array.from({ length: HSSC_POSITION_COUNT }, (_, index) => directionIdAt(index)) };
}

// WHY: a config placed by another stations version than the caller's (a sync between the two reads) would name another
// station's direction at this index, so it names none.
export function toStationDirection(group: BusGroup | null, stationIndex: number, stationsVersion: string | null): StationDirection | null {
  if (group === null || !("directions" in group.screen) || (group.screen.stationsVersion ?? null) !== stationsVersion) return null;
  const directionId = group.screen.stations[stationIndex]?.directionId ?? null;
  const direction = group.screen.directions.find((candidate) => candidate.id === directionId);
  return direction ? { id: direction.id, label: direction.label } : null;
}
