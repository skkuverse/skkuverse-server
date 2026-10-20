import { MAX_UPSTREAM_PLATFORMS, SUBWAY_STATIONS } from "../subway.constants";
import type { NetworkIssue, PlatformDirection, SubwayDirection, SubwayNetwork, SubwayRegistry } from "../subway.types";
import type { LineRoutes } from "../timetable/subway-timetable.types";
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

const ROUTE_PLACES = { upstreamPlatformIds: "the stops before", watchedPlatformIds: "the stops before the upstream ones of", nextPlatformId: "the stop after" } as const;

function directionRouteIssues(at: IssuePath, direction: PlatformDirection, { route, platformId }: { route: readonly string[]; platformId: string }): NetworkIssue[] {
  const index = route.indexOf(platformId);
  if (index === -1) return [{ path: at, message: `"${platformId}" is not on its timetable route` }];
  const start = Math.max(0, index - MAX_UPSTREAM_PLATFORMS);
  const expected = { upstreamPlatformIds: route.slice(start, index).reverse(), watchedPlatformIds: route.slice(0, start).reverse(), nextPlatformId: route[index + 1] ?? null };
  return (Object.keys(ROUTE_PLACES) as Array<keyof typeof ROUTE_PLACES>)
    .filter((key) => JSON.stringify(direction[key]) !== JSON.stringify(expected[key]))
    .map((key) => ({ path: [...at, key], message: `must be ${JSON.stringify(expected[key])}, ${ROUTE_PLACES[key]} "${platformId}" on its timetable route, nearest first` }));
}

// WHY: the tracker follows every stop on the route before a served platform, and the pollers name a stop's rows only by
// a served platform or a neighbor (spec "Topology push follows the timetable routes"). Each route is one day type's.
export function toRouteIssues(topology: SubwayTopologyData, routesByPlatformId: Readonly<Record<string, readonly LineRoutes[]>>): NetworkIssue[] {
  const isNamedStop = (id: string): boolean => Object.hasOwn(routesByPlatformId, id) || Object.hasOwn(topology.neighbors, id);
  const issues = Object.entries(routesByPlatformId).flatMap(([platformId, routes]) =>
    routes.flatMap((lineRoutes) =>
      DIRECTIONS.flatMap((direction): NetworkIssue[] => {
        const directions = topology.platforms[platformId];
        if (directions === undefined) return [];
        const at = ["platforms", platformId, direction];
        const route = lineRoutes[direction];
        const unnamed = route.slice(0, Math.max(0, route.indexOf(platformId))).filter((id) => !isNamedStop(id));
        const unnamedIssues = unnamed.map((id) => ({ path: at, message: `"${id}" is on the timetable route the tracker follows to "${platformId}", and is neither a served platform nor a neighbor` }));
        return [...directionRouteIssues(at, directions[direction], { route, platformId }), ...unnamedIssues];
      }),
    ),
  );
  return [...new Map(issues.map((issue) => [`${issue.path.join(".")}: ${issue.message}`, issue])).values()];
}
