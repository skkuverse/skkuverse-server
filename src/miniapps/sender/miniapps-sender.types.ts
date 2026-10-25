import type { MiniAppRegistry } from "../miniapps.types";

/**
 * WHY: the snapshot the sender was authorized against, so its link is checked against the same revision; `keyId`
 * names the registered key that signed the call, null for a call signed by no key (the shared push token, local-dev).
 */
export type PushSender = { miniAppId: string; keyId: string | null; registry: Pick<MiniAppRegistry, "isKnownMiniAppTarget"> };
