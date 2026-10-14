import type { MiniappsService } from "../miniapps/miniapps.service";

export type MiniAppRegistry = Pick<MiniappsService, "map" | "isKnownMiniAppTarget" | "isSingleEmoji">;

