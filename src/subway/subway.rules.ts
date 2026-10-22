import { SUBWAY_LINES } from "./subway.constants";
import type { NetworkIssue, NetworkPlatform, NetworkStation, SubwayLine, SubwayNetwork } from "./subway.types";

type IssuePath = NetworkIssue["path"];

// WHY: unreachable for a served platform: the subway.rules spec refuses a platform of an unlisted line in SUBWAY_STATIONS.
export function toSubwayLine(code: string): SubwayLine {
  const line = SUBWAY_LINES.find((listed) => listed.code === code);
  if (!line) throw new Error(`subway network: no line "${code}"`);
  return line;
}

const platformsOf = (network: SubwayNetwork) =>
  network.stations.flatMap((station, i) => station.platforms.map((platform, j) => ({ at: ["stations", i, "platforms", j], platform, station })));

function repeatIssues<T>(entries: ReadonlyArray<{ at: IssuePath; value: T }>, kind: string): NetworkIssue[] {
  const seen = new Set<T>();
  return entries.flatMap(({ at, value }) => {
    const isRepeat = seen.has(value);
    seen.add(value);
    return isRepeat ? [{ path: at, message: `${kind} "${String(value)}" is listed twice` }] : [];
  });
}

function duplicateIssues(network: SubwayNetwork): NetworkIssue[] {
  return [
    ...repeatIssues(network.lines.map((line, i) => ({ at: ["lines", i, "code"], value: line.code })), "line"),
    ...repeatIssues(network.lines.map((line, i) => ({ at: ["lines", i, "seoul", "subwayId"], value: line.seoul.subwayId })), "subwayId"),
    ...repeatIssues(network.stations.map((station, i) => ({ at: ["stations", i, "id"], value: station.id })), "station"),
    ...repeatIssues(platformsOf(network).map(({ at, platform }) => ({ at: [...at, "id"], value: platform.id })), "platform"),
  ];
}

function platformLineIssues(network: SubwayNetwork): NetworkIssue[] {
  const codes = new Set(network.lines.map((line) => line.code));
  const platforms = platformsOf(network);
  const isSecondOfLine = (station: NetworkStation, platform: NetworkPlatform): boolean => station.platforms.find((other) => other.line === platform.line) !== platform;
  return [
    ...platforms.flatMap(({ at, platform }) => (codes.has(platform.line) ? [] : [{ path: [...at, "line"], message: `"${platform.line}" is not a listed line` }])),
    ...platforms.flatMap(({ at, platform, station }) =>
      isSecondOfLine(station, platform) ? [{ path: [...at, "line"], message: `station "${station.id}" has a second platform on line "${platform.line}"` }] : [],
    ),
    ...network.lines.flatMap((line, i) =>
      platforms.some(({ platform }) => platform.line === line.code) ? [] : [{ path: ["lines", i, "code"], message: `line "${line.code}" has no platform` }],
    ),
  ];
}

/** WHY: no boot check of code against code; the data tool runs it before a topology push (ADR 0013, D2). */
export function toNetworkIssues(network: SubwayNetwork): NetworkIssue[] {
  return [...duplicateIssues(network), ...platformLineIssues(network)];
}
