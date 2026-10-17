import type { BusGroup } from "../../bus/config/bus-config.wire";
import type { SupportedLang } from "../../infra/types";
import type { ServedStation } from "../../subway/stations/subway-stations.types";
import { toLocalizedText, toServedActionValue } from "../ui.mapper";
import { toTransitItemId } from "./ui-transit.rules";
import type { TransitItemRaw, TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayout } from "./ui-transit.wire";

type TransitSection = TransitLayout["sections"][number];
type TransitItem = TransitSection["items"][number];
type LinkItemRaw = Extract<TransitItemRaw, { kind: "link" }>;

interface TransitSectionContext {
  lang: SupportedLang;
  busGroupById: ReadonlyMap<string, BusGroup>;
  stationById: ReadonlyMap<string, ServedStation>;
}

function toBusTransitItem(group: BusGroup): TransitItem {
  const screen = group.screenType === "realtime" ? "/bus/realtime" : "/bus/schedule";
  return {
    kind: "bus",
    id: toTransitItemId({ kind: "bus", groupId: group.id }),
    groupId: group.id,
    title: group.label,
    // WHY: `||`, not `??`: a blank subtitle is served as null too, as the bus list serves it.
    subtitle: group.card.subtitle || null,
    icon: { type: group.card.iconType, color: group.card.themeColor, text: group.card.busTypeText },
    action: { actionType: "route", actionValue: `${screen}?groupId=${group.id}` },
  };
}

function toSubwayTransitItem(station: ServedStation, lang: SupportedLang): TransitItem {
  return {
    kind: "subway",
    id: toTransitItemId({ kind: "subway", stationId: station.id }),
    stationId: station.id,
    title: station.title[lang],
    subtitle: station.lineLabel[lang],
    icon: { type: "subway", color: station.lineColor, text: station.lineCode },
    action: { actionType: "route", actionValue: `/subway?station=${station.id}` },
  };
}

function toLinkTransitItem(link: LinkItemRaw, lang: SupportedLang): TransitItem {
  return {
    kind: "link",
    id: link.id,
    title: toLocalizedText(link.title, lang),
    subtitle: link.subtitle === undefined ? null : toLocalizedText(link.subtitle, lang),
    icon: { type: link.icon.type, color: link.icon.color, text: toLocalizedText(link.icon.text, lang) },
    action: { actionType: link.actionType, actionValue: toServedActionValue(link.actionType, link.actionValue) },
  };
}

// WHY: the loader placed every referent at boot; a group missing here is one outside its visibility.
function toTransitItems(item: TransitItemRaw, context: TransitSectionContext): TransitItem[] {
  if (item.kind === "link") return [toLinkTransitItem(item, context.lang)];
  if (item.kind === "bus") {
    const group = context.busGroupById.get(item.groupId);
    return group === undefined ? [] : [toBusTransitItem(group)];
  }
  const station = context.stationById.get(item.stationId);
  if (station === undefined) throw new Error(`transit layout places subway station "${item.stationId}", which is not served`);
  return [toSubwayTransitItem(station, context.lang)];
}

export function toTransitSection(section: TransitLayoutRaw["sections"][number], context: TransitSectionContext): TransitSection {
  return {
    type: "item_list",
    id: section.id,
    title: toLocalizedText(section.title, context.lang),
    items: section.items.flatMap((item) => toTransitItems(item, context)),
  };
}
