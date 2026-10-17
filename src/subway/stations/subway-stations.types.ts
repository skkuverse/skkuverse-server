import type { LocalizedName } from "../subway.types";

export interface SubwayLine {
  label: LocalizedName;
  color: string;
}

export interface ServedStation {
  id: string;
  title: LocalizedName;
  lineCode: string;
  lineLabel: LocalizedName;
  lineColor: string;
}
