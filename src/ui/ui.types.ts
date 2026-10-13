import type { MiniAppsService } from "../miniapps/miniapps.service";

export type MiniAppRegistry = Pick<MiniAppsService, "map" | "isKnownMiniAppTarget" | "isSingleEmoji">;

export type LogoResolver = MiniAppsService["resolveLogo"];
