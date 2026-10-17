import fs from "fs";
import path from "path";
import { parseConfigFile } from "../infra/config-file";
import { subwayRegistryFile } from "./subway.schema";
import type { SubwayPlatform, SubwayRegistry, SubwayStation } from "./subway.types";

// WHY: read next to the compiled file at runtime; scripts/copy-build-assets.js stages the JSON into dist/.
const SUBWAY_REGISTRY_FILE = path.join(__dirname, "subway-registry.json");

type IssuePath = Array<string | number>;
type Issue = { path: IssuePath; message: string };

interface Located<T> {
  at: IssuePath;
  value: T;
}

const platformsOf = (registry: SubwayRegistry) =>
  registry.stations.flatMap((station, i) => station.platforms.map((value, j) => ({ at: ["stations", i, "platforms", j], value, station })));

function repeatIssues<T>(entries: ReadonlyArray<Located<T>>, kind: string): Issue[] {
  const seen = new Set<T>();
  return entries.flatMap(({ at, value }) => {
    const isRepeat = seen.has(value);
    seen.add(value);
    return isRepeat ? [{ path: at, message: `${kind} "${String(value)}" is listed twice` }] : [];
  });
}

function duplicateIssues(registry: SubwayRegistry): Issue[] {
  return [
    ...repeatIssues(registry.lines.map((line, i) => ({ at: ["lines", i, "code"], value: line.code })), "line"),
    ...repeatIssues(registry.lines.map((line, i) => ({ at: ["lines", i, "seoul", "subwayId"], value: line.seoul.subwayId })), "subwayId"),
    ...repeatIssues(registry.stations.map((station, i) => ({ at: ["stations", i, "id"], value: station.id })), "station"),
    ...repeatIssues(platformsOf(registry).map(({ at, value }) => ({ at: [...at, "id"], value: value.id })), "platform"),
  ];
}

function lineIssues(registry: SubwayRegistry): Issue[] {
  const lineByCode = new Map(registry.lines.map((line) => [line.code, line]));
  const platforms = platformsOf(registry);
  const unknown = (at: IssuePath, code: string): Issue[] => (lineByCode.has(code) ? [] : [{ path: at, message: `"${code}" is not a listed line` }]);
  const isSecondOfLine = (station: SubwayStation, platform: SubwayPlatform): boolean =>
    station.platforms.find((other) => other.line === platform.line) !== platform;
  return [
    ...platforms.flatMap(({ at, value }) => unknown([...at, "line"], value.line)),
    ...platforms.flatMap(({ at, value, station }) =>
      isSecondOfLine(station, value) ? [{ path: [...at, "line"], message: `station "${station.id}" has a second platform on line "${value.line}"` }] : [],
    ),
    ...Object.entries(registry.neighbors).flatMap(([id, neighbor]) => [
      ...unknown(["neighbors", id, "line"], neighbor.line),
      ...(neighbor.trainMapName !== undefined && lineByCode.get(neighbor.line)?.seoul.trainMapLine === undefined
        ? [{ path: ["neighbors", id, "trainMapName"], message: `line "${neighbor.line}" has no train map` }]
        : []),
    ]),
    ...registry.lines.flatMap((line, i) =>
      platforms.some(({ value }) => value.line === line.code) ? [] : [{ path: ["lines", i, "code"], message: `line "${line.code}" has no platform` }],
    ),
  ];
}

function namedPlatformIssues(registry: SubwayRegistry): Issue[] {
  const platforms = platformsOf(registry);
  const servedLineById = new Map(platforms.map(({ value }) => [value.id, value.line]));
  return platforms.flatMap(({ at, value: platform }) =>
    (["up", "down"] as const).flatMap((direction) => {
      const { upstreamPlatformIds, watchedPlatformIds, nextPlatformId } = platform.directions[direction];
      const named: Array<Located<string> & { isNeighborStop: boolean }> = [
        ...upstreamPlatformIds.map((id, k) => ({ at: [...at, "directions", direction, "upstreamPlatformIds", k], value: id, isNeighborStop: k === 0 })),
        ...watchedPlatformIds.map((id, k) => ({ at: [...at, "directions", direction, "watchedPlatformIds", k], value: id, isNeighborStop: false })),
        { at: [...at, "directions", direction, "nextPlatformId"], value: nextPlatformId, isNeighborStop: true },
      ];
      return named.flatMap(({ at: namedAt, value: id, isNeighborStop }): Issue[] => {
        const neighbor = registry.neighbors[id];
        const line = servedLineById.get(id) ?? neighbor?.line;
        if (line === undefined) return [{ path: namedAt, message: `"${id}" is neither a served platform nor a neighbor` }];
        if (line !== platform.line) return [{ path: namedAt, message: `"${id}" is on line "${line}", not "${platform.line}"` }];
        const isUnnamed = isNeighborStop && !servedLineById.has(id) && neighbor?.name === undefined;
        return isUnnamed ? [{ path: namedAt, message: `neighbor "${id}" is a previous or next station and has no name` }] : [];
      });
    }),
  );
}

export function loadSubwayRegistry(raw: unknown): SubwayRegistry {
  const schema = subwayRegistryFile.superRefine((registry, ctx) => {
    const issues = [...duplicateIssues(registry), ...lineIssues(registry), ...namedPlatformIssues(registry)];
    for (const { path: at, message } of issues) ctx.addIssue({ code: "custom", path: at, message });
  });
  return parseConfigFile("subway registry", schema, raw);
}

export const SUBWAY_REGISTRY: SubwayRegistry = loadSubwayRegistry(JSON.parse(fs.readFileSync(SUBWAY_REGISTRY_FILE, "utf8")));
