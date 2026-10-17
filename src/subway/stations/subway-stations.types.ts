import type { LocalizedName } from "../subway.types";

export interface ServedLine {
  code: string;
  name: LocalizedName;
  badge: LocalizedName;
  color: string;
}

export interface ServedStation {
  id: string;
  title: LocalizedName;
  lines: readonly ServedLine[];
}
