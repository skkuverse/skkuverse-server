import { t } from "../infra/i18n";
import type { SupportedLang } from "../infra/types";
import type { BuildingDoc } from "./building.document";
import { toDisplayNo } from "./building.rules";
import type { BilingualText, BuildNo, Campus, WithCampusLabel } from "./building.types";
import type { BuildingCard } from "./building.wire";

function campusLabel(campus: Campus, lang: SupportedLang): string {
  return t(`map.campus.${campus}.label`, lang);
}

function withCampusLabel<T extends { campus: Campus }>(item: T, lang: SupportedLang): WithCampusLabel<T> {
  return { ...item, campusLabel: campusLabel(item.campus, lang) };
}

/** WHY: `displayNo` is building's own derivation, so a read derives it rather than trust the writer's copy. */
function withDisplayNo<T extends { buildNo: BuildNo | null; campus: Campus }>(building: T): T & Pick<BuildingDoc, "displayNo"> {
  return { ...building, displayNo: toDisplayNo(building.buildNo, building.campus) };
}

/** WHY: `updatedAt` becomes the ISO string JSON already made of the Date, so the card fits its wire type. */
function toBuildingCard(building: BuildingDoc, lang: SupportedLang): BuildingCard {
  return { ...withCampusLabel(building, lang), updatedAt: building.updatedAt?.toISOString() };
}

function withEnFallback<T extends Partial<BilingualText> | undefined>(text: T): T {
  if (text && !text.en && text.ko) return { ...text, en: text.ko };
  return text;
}

export { campusLabel, toBuildingCard, withCampusLabel, withDisplayNo, withEnFallback };
