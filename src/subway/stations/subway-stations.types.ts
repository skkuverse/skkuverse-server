import type { LineMarker, LocalizedName } from "../subway.types";

export interface ServedLine {
  code: string;
  name: LocalizedName;
  color: string;
  marker: LineMarker;
}

export interface ServedStation {
  id: string;
  title: LocalizedName;
  lines: readonly ServedLine[];
}
