import type { I18n } from "../infra/types";
import type { I18nText } from "./map.wire";

/**
 * WHY: `||`, not `??`: an ops sheet round-trips a missing translation as "", which would ship a blank line.
 * Total: a zh-only value passes `hasAnyText`, and the app reads `ko` unconditionally.
 */
export function toI18nText(text: I18n): I18nText {
  const ko = text.ko || text.en || text.zh || "";
  return { ko, en: text.en || ko, ...(text.zh ? { zh: text.zh } : {}) };
}
