import type { LocalizedName, NetworkStation, SubwayLine } from "../subway.types";
import { STATION_SUFFIX } from "./subway-stations.constants";
import type { ServedStation } from "./subway-stations.types";

function toStationTitle(name: LocalizedName): LocalizedName {
  return { ko: `${name.ko}${STATION_SUFFIX.ko}`, en: `${name.en}${STATION_SUFFIX.en}`, zh: `${name.zh}${STATION_SUFFIX.zh}` };
}

export function toServedStation(station: NetworkStation, lineOf: (code: string) => SubwayLine): ServedStation {
  const lines = station.platforms.map(({ line: code }) => {
    const { name, color, marker } = lineOf(code);
    return { code, name, color, marker };
  });
  return { id: station.id, title: toStationTitle(station.name), lines };
}
