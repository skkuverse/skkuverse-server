import type { MiniappsService } from "../miniapps/miniapps.service";

export type MiniAppRegistry = Pick<MiniappsService, "isRegistered" | "isKnownMiniAppTarget" | "isSingleEmoji" | "parseTarget">;

