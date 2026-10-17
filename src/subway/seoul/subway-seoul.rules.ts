import type { CountdownRow, SubwayRegistry, TrainEvent } from "../subway.types";
import type { SeoulLine, SeoulStation, SettledObservations } from "./subway-seoul.types";

// WHY: a row names its station, not its platform, so each line maps the names it writes to its own platforms: the
// served ones and their neighbors, by the Seoul API's name and by the train map's where that differs.
export function toSeoulLines(registry: SubwayRegistry): SeoulLine[] {
  return registry.lines.map(({ code, seoul }) => {
    const stations = registry.stations.flatMap((station) => station.platforms.filter((p) => p.line === code).map((platform) => ({ station, platform })));
    const neighbors = Object.entries(registry.neighbors).filter(([, neighbor]) => neighbor.line === code);
    const platformIdByApiName = new Map([
      ...stations.map(({ station, platform }) => [station.seoulName, platform.id] as const),
      ...neighbors.map(([id, neighbor]) => [neighbor.seoulName, id] as const),
    ]);
    const platformIdByTrainMapName = new Map([
      ...stations.map(({ station, platform }) => [station.seoulName, platform.id] as const),
      ...neighbors.map(([id, neighbor]) => [neighbor.trainMapName ?? neighbor.seoulName, id] as const),
    ]);
    const { subwayId, lineName, trainMapLine, trainNumbers } = seoul;
    return { subwayId, lineName, trainMapLine, trainNumbers, platformIdByApiName, platformIdByTrainMapName };
  });
}

// WHY: one arrival call per physical station answers every line there, so each station maps a row's `subwayId` to
// its own platform of that line.
export function toSeoulStations(registry: SubwayRegistry): SeoulStation[] {
  const lineByCode = new Map(registry.lines.map((line) => [line.code, line.seoul]));
  return registry.stations.map(({ seoulName, platforms }) => ({
    seoulName,
    platformBySubwayId: new Map(
      platforms.flatMap(({ id, line }) => {
        const seoul = lineByCode.get(line);
        return seoul ? [[seoul.subwayId, { platformId: id, trainNumbers: seoul.trainNumbers }] as const] : [];
      }),
    ),
  }));
}

export function toSettledObservations(
  source: string,
  eventResults: readonly PromiseSettledResult<readonly TrainEvent[]>[],
  countdownResults: readonly PromiseSettledResult<readonly CountdownRow[]>[],
): SettledObservations {
  const failures = [...eventResults, ...countdownResults].flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
  const isEveryCallFailed = failures.length > 0 && failures.length === eventResults.length + countdownResults.length;
  if (isEveryCallFailed) throw failures[0];
  return { source, events: toAnswers(eventResults), countdownRows: toAnswers(countdownResults), failures };
}

function toAnswers<T>(results: readonly PromiseSettledResult<readonly T[]>[]): T[] {
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}
