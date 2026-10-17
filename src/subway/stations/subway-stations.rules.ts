import type { LocalizedName, SubwayStation } from "../subway.types";
import { LINE_BY_LINE_CODE, STATION_SUFFIX } from "./subway-stations.constants";
import type { ServedStation } from "./subway-stations.types";

function toStationTitle(name: LocalizedName): LocalizedName {
  return { ko: `${name.ko}${STATION_SUFFIX.ko}`, en: `${name.en}${STATION_SUFFIX.en}`, zh: `${name.zh}${STATION_SUFFIX.zh}` };
}

export function toServedStation(station: SubwayStation): ServedStation {
  const line = LINE_BY_LINE_CODE[station.lineCode];
  if (line === undefined) throw new Error(`subway station "${station.id}" is on line "${station.lineCode}", which LINE_BY_LINE_CODE does not list`);
  return {
    id: station.id,
    title: toStationTitle(station.name),
    lineCode: station.lineCode,
    lineLabel: line.label,
    lineColor: line.color,
  };
}
