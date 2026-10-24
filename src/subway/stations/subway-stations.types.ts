import type { Campus } from "../../shared/campus.wire";
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
  campus: Campus;
  lines: readonly ServedLine[];
}
