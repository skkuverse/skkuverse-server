import type { CountdownRow, SubwayRegistry, TrainEvent } from "../subway.types";
import type { TrainMapLine } from "../seoul-trainmap/subway-seoul-trainmap.types";
import type { SeoulLine, SeoulStation, SettledObservations } from "./subway-seoul.types";

// WHY: an API row carries its station's statnId, which only the served platforms declare, so each line matches those by
// statnId and its neighbors by the Seoul API's name; the train map writes names only, the served stations' too.
export function toSeoulLines(registry: SubwayRegistry): SeoulLine[] {
  return registry.lines.map(({ code, seoul }) => {
    const stations = registry.stations.flatMap((station) => station.platforms.filter((p) => p.line === code).map((platform) => ({ station, platform })));
    const neighbors = Object.entries(registry.neighbors).filter(([, neighbor]) => neighbor.line === code);
    const platformIdByStatnId = new Map(stations.map(({ platform }) => [platform.statnId, platform.id] as const));
    const platformIdByApiName = new Map(neighbors.map(([id, neighbor]) => [neighbor.seoulName, id] as const));
    const platformIdByTrainMapName = new Map([
      ...stations.map(({ station, platform }) => [station.seoulName, platform.id] as const),
      ...neighbors.map(([id, neighbor]) => [neighbor.trainMapName ?? neighbor.seoulName, id] as const),
    ]);
    const { subwayId, lineName, trainMapLine, trainNumbers } = seoul;
    return { subwayId, lineName, trainMapLine, trainNumbers, platformIdByStatnId, platformIdByApiName, platformIdByTrainMapName };
  });
}

// WHY: one arrival call per physical station answers every line there, so each station maps a row's `statnId` to
// its own platform of that line.
export function toSeoulStations(registry: SubwayRegistry): SeoulStation[] {
  const lineByCode = new Map(registry.lines.map((line) => [line.code, line.seoul]));
  return registry.stations.map(({ seoulName, platforms }) => ({
    seoulName,
    platformByStatnId: new Map(
      platforms.flatMap(({ id, line, statnId }) => {
        const seoul = lineByCode.get(line);
        return seoul ? [[statnId, { platformId: id, trainNumbers: seoul.trainNumbers }] as const] : [];
      }),
    ),
  }));
}

export function toTrainMapLines(lines: readonly SeoulLine[]): TrainMapLine[] {
  return lines.flatMap(({ trainMapLine, platformIdByTrainMapName }) =>
    trainMapLine === undefined ? [] : [{ trainMapLine, platformIdByName: platformIdByTrainMapName }],
  );
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
