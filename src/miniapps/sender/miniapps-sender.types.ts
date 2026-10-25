import type { MiniAppPushQuota } from "../../perimeter/perimeter.ports";
import type { MiniAppRegistry } from "../miniapps.types";

/** WHY: the snapshot the sender was authorized against, so its link is checked against the same revision. */
export type PushSender = { miniAppId: string; registry: Pick<MiniAppRegistry, "isKnownMiniAppTarget">; quota: Pick<MiniAppPushQuota, "take"> };
