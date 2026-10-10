import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import type { BilingualText, Campus, WithCampusLabel } from "./building.types";

function campusLabel(campus: Campus, lang: SupportedLang): string {
  return t(`map.campus.${campus}.label`, lang);
}

function withCampusLabel<T extends { campus: Campus }>(item: T, lang: SupportedLang): WithCampusLabel<T> {
  return { ...item, campusLabel: campusLabel(item.campus, lang) };
}

/** An empty English side shows the Korean one. */
function withEnFallback<T extends Partial<BilingualText> | undefined>(text: T): T {
  if (text && !text.en && text.ko) return { ...text, en: text.ko };
  return text;
}

export { campusLabel, withCampusLabel, withEnFallback };
