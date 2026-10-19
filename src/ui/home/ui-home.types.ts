import type { MiniappsService } from "../../miniapps/miniapps.service";
import type { HomeLayoutRaw } from "./ui-home.schema";

export type LogoResolver = MiniappsService["resolveLogo"];

export interface HomeLayoutIssue {
  path: Array<string | number>;
  message: string;
}

export interface HomeLayoutReference {
  dataset: "miniapps";
  id: string;
  path: Array<string | number>;
}

export interface HomeLayoutRevision {
  revision: number;
  layout: HomeLayoutRaw;
}

/** WHY: keyed `<layout revision>@<registry revision>`, `-` for none read, so a push of either recomputes it. */
export interface ResolvedHomeLayout {
  key: string;
  layout: HomeLayoutRaw;
}
