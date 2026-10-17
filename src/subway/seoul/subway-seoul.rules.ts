import type { CountdownRow, SubwayRegistry, TrainEvent } from "../subway.types";
import type { SeoulLine, SettledObservations } from "./subway-seoul.types";

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
    return { subwayId, lineName, trainMapLine, trainNumbers, stationNames: stations.map(({ station }) => station.seoulName), platformIdByApiName, platformIdByTrainMapName };
  });
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
