const LANGS = ["ko", "en", "zh"] as const;

export type SupportedLang = (typeof LANGS)[number];

export const SUPPORTED_LANGS: readonly SupportedLang[] = LANGS;

export interface I18n {
  ko: string;
  en?: string;
  zh?: string;
}
