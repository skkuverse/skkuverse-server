export type SupportedLang = "ko" | "en" | "zh";

/**
 * The same three, as a value — for iterating. Import this rather than writing
 * the array out: a language added to the union and missed in one hand-written
 * list is a session "blank in every language" that is not, or a manifest that
 * refuses a `?lang=` the union admits.
 */
export const SUPPORTED_LANGS: readonly SupportedLang[] = ["ko", "en", "zh"];

/**
 * Authored text in every language we hold. `ko` is the source language and
 * required; `en`/`zh` are optional. Resolved with `pick()` in `./i18n` —
 * `text[lang] → en → ko`, blank treated as absent — so no consumer ever ships
 * one of these objects to a client.
 *
 * Infra rather than a feature type: the event map authors its content this way,
 * and the map catalogue authors its layer and chip labels the same way, so the
 * one resolver they share has to live where both can reach it without either
 * importing the other.
 */
export interface I18n {
  ko: string;
  en?: string;
  zh?: string;
}
