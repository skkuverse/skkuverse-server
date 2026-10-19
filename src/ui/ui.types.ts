import type { MiniappsService } from "../miniapps/miniapps.service";

export type MiniAppRegistry = Pick<MiniappsService, "isRegistered" | "isKnownMiniAppTarget" | "isSingleEmoji" | "parseTarget">;

export type TargetGrammar = Pick<MiniAppRegistry, "parseTarget">;

export interface MiniAppReference {
  dataset: "miniapps";
  id: string;
  path: Array<string | number>;
}
