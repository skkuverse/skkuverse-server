import type { SubwayStation } from "../subway.types";
import type { SeoulLine } from "./subway-seoul.types";

export function toSeoulLines(
  stations: readonly SubwayStation[],
  lineNameBySubwayId: Readonly<Record<string, string>>,
  stationNameById: Readonly<Record<string, string>>,
): SeoulLine[] {
  const firstOfLine = stations.filter((station, i) => stations.findIndex((s) => s.seoul.subwayId === station.seoul.subwayId) === i);
  return firstOfLine.map(({ seoul: { subwayId, trainMapLine } }) => {
    const lineName = lineNameBySubwayId[subwayId];
    if (lineName === undefined) throw new Error(`subway: no Seoul line name for subwayId ${subwayId}`);
    const served = stations.filter((station) => station.seoul.subwayId === subwayId);
    const stationIdByName = new Map(
      served.flatMap((station) => [[station.seoul.stationName, station.id] as const, ...toUpstreamNames(station, stationNameById)]),
    );
    return { subwayId, lineName, trainMapLine, stationNames: served.map((s) => s.seoul.stationName), stationIdByName };
  });
}

function toUpstreamNames(station: SubwayStation, stationNameById: Readonly<Record<string, string>>): Array<readonly [string, string]> {
  const { up, down } = station.directions;
  return [...up.upstreamStationIds, ...down.upstreamStationIds].map((upstreamId) => {
    const upstreamName = stationNameById[upstreamId];
    if (upstreamName === undefined) throw new Error(`subway: no Seoul station name for ${upstreamId}`);
    return [upstreamName, upstreamId] as const;
  });
}
