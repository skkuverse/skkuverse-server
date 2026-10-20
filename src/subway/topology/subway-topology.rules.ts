import { SUBWAY_STATIONS } from "../subway.constants";
import type { NetworkIssue, PlatformDirection, SubwayDirection, SubwayNetwork, SubwayRegistry } from "../subway.types";
import type { SubwayTopologyData } from "./subway-topology.types";

type IssuePath = NetworkIssue["path"];

const DIRECTIONS: readonly SubwayDirection[] = ["up", "down"];

interface NamedStop {
  at: IssuePath;
  id: string;
  isNeighborStop: boolean;
}

export function toMissingPlatformIds({ platforms }: SubwayTopologyData, platformIds: readonly string[]): string[] {
  return platformIds.filter((platformId) => !Object.hasOwn(platforms, platformId));
}

export function toUnknownPlatformIds({ platforms }: SubwayTopologyData, platformIds: readonly string[]): string[] {
  const served = new Set(platformIds);
  return Object.keys(platforms).filter((platformId) => !served.has(platformId));
}

function toNamedStops(at: IssuePath, { upstreamPlatformIds, watchedPlatformIds, nextPlatformId }: PlatformDirection): NamedStop[] {
  return [
    ...upstreamPlatformIds.map((id, k) => ({ at: [...at, "upstreamPlatformIds", k], id, isNeighborStop: k === 0 })),
    ...watchedPlatformIds.map((id, k) => ({ at: [...at, "watchedPlatformIds", k], id, isNeighborStop: false })),
    { at: [...at, "nextPlatformId"], id: nextPlatformId, isNeighborStop: true },
  ];
}

// WHY: a served platform named as a neighbor stop takes its station's name, so only a neighbor needs one of its own.
function namedPlatformIssues(topology: SubwayTopologyData, network: SubwayNetwork): NetworkIssue[] {
  const servedLineById = new Map(network.stations.flatMap((station) => station.platforms.map((platform) => [platform.id, platform.line] as const)));
  return [...servedLineById].flatMap(([platformId, platformLine]) => {
    const directions = topology.platforms[platformId];
    if (directions === undefined) return [];
    const stops = DIRECTIONS.flatMap((direction) => toNamedStops(["platforms", platformId, direction], directions[direction]));
    return stops.flatMap(({ at, id, isNeighborStop }): NetworkIssue[] => {
      const neighbor = topology.neighbors[id];
      const line = servedLineById.get(id) ?? neighbor?.line;
      if (line === undefined) return [{ path: at, message: `"${id}" is neither a served platform nor a neighbor` }];
      if (line !== platformLine) return [{ path: at, message: `"${id}" is on line "${line}", not "${platformLine}"` }];
      const isUnnamed = isNeighborStop && !servedLineById.has(id) && neighbor?.name === undefined;
      return isUnnamed ? [{ path: at, message: `neighbor "${id}" is a previous or next station and has no name` }] : [];
    });
  });
}

function neighborLineIssues({ neighbors }: SubwayTopologyData, network: SubwayNetwork): NetworkIssue[] {
  const lineByCode = new Map(network.lines.map((line) => [line.code, line]));
  return Object.entries(neighbors).flatMap(([id, neighbor]) => {
    const line = lineByCode.get(neighbor.line);
    if (line === undefined) return [{ path: ["neighbors", id, "line"], message: `"${neighbor.line}" is not a listed line` }];
    const hasNoTrainMap = neighbor.trainMapName !== undefined && line.seoul.trainMapLine === undefined;
    return hasNoTrainMap ? [{ path: ["neighbors", id, "trainMapName"], message: `line "${neighbor.line}" has no train map` }] : [];
  });
}

/** WHY: the stored topology must place exactly the platforms the checked-out code serves (spec "Topology push names every code-held platform exactly once"). */
export function toTopologyIssues(topology: SubwayTopologyData, network: SubwayNetwork): NetworkIssue[] {
  const platformIds = network.stations.flatMap((station) => station.platforms.map((platform) => platform.id));
  return [
    ...toMissingPlatformIds(topology, platformIds).map((id) => ({
      path: ["platforms", id],
      message: `platform "${id}" is unplaced: the checked-out code serves it, so it needs directions`,
    })),
    ...toUnknownPlatformIds(topology, platformIds).map((id) => ({ path: ["platforms", id], message: `"${id}" is not a platform the checked-out code serves` })),
    ...namedPlatformIssues(topology, network),
    ...neighborLineIssues(topology, network),
  ];
}

// WHY: the stops the arrivals mapper serves as null, named as it names them: a topology pushed ahead of a deploy may
// promote a neighbor to a platform the running code does not serve yet, dropping the entry that named it.
export function toUnnamedStopIds(registry: SubwayRegistry): string[] {
  const servedIds = new Set(SUBWAY_STATIONS.flatMap((station) => station.platforms.map((platform) => platform.id)));
  const stopIds = registry.stations.flatMap((station) =>
    station.platforms.flatMap((platform) => DIRECTIONS.flatMap((direction) => [platform.directions[direction].upstreamPlatformIds[0], platform.directions[direction].nextPlatformId])),
  );
  const isUnnamed = (id: string): boolean => !servedIds.has(id) && registry.neighbors[id]?.name === undefined;
  return [...new Set(stopIds.filter((id): id is string => id !== undefined && isUnnamed(id)))];
}
