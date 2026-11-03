const LANGS = ["ko", "en", "zh"] as const;

export type SupportedLang = (typeof LANGS)[number];

export const SUPPORTED_LANGS: readonly SupportedLang[] = LANGS;

export interface I18n {
  ko: string;
  en?: string;
  zh?: string;
}

/** WHY: why an upstream gave no usable answer, so a log line alone tells an outage from a refused key or a spent quota. */
export type UpstreamFailure =
  | { kind: "outage"; status: number }
  | { kind: "outage"; reason: string }
  | { kind: "auth"; status: number; message: string }
  | { kind: "quota"; message: string }
  | { kind: "timeout" }
  | { kind: "shape"; detail: string };
