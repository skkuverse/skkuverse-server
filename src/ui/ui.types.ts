import type { MiniappsService } from "../miniapps/miniapps.service";

type MiniAppRegistrySnapshot = Awaited<ReturnType<MiniappsService["current"]>>;

export type MiniAppRegistry = Pick<MiniAppRegistrySnapshot, "isRegistered" | "isKnownMiniAppTarget" | "isSingleEmoji" | "parseTarget">;

export type MiniAppGrammar = Pick<MiniappsService, "parseTarget" | "isSingleEmoji">;

export type TargetGrammar = Pick<MiniAppRegistry, "parseTarget">;

export interface MiniAppReference {
  dataset: "miniapps";
  id: string;
  path: Array<string | number>;
}
