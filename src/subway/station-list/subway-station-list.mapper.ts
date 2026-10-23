import type { SupportedLang } from "../../infra/types";
import type { LatLng } from "../../shared/lat-lng.types";
import type { ServedStation } from "../stations/subway-stations.types";
import type { SubwayStationList } from "./subway-station-list.wire";

type ListedStation = SubwayStationList["stations"][number];

export function toListedStation(station: ServedStation, coords: LatLng | null, lang: SupportedLang): ListedStation {
  const lines = station.lines.map(({ code, name, color, marker }) => ({ code, name: name[lang], color, marker: { text: marker.text[lang], color: marker.color } }));
  return { id: station.id, title: station.title[lang], lines, coords };
}
