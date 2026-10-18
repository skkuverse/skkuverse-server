import type { BusGroup } from "../../bus/config/bus-config.wire";
import type { SupportedLang } from "../../infra/types";
import type { ServedStation } from "../../subway/stations/subway-stations.types";
import { toLocalizedText } from "../ui.mapper";
import { toServedActionValue } from "../../shared/link-action.util";
import { toTransitItemId } from "./ui-transit.rules";
import type { TransitChildRaw, TransitItemRaw, TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayout } from "./ui-transit.wire";

type TransitSection = TransitLayout["sections"][number];
type TransitItem = TransitSection["items"][number];
type TransitChild = Exclude<TransitItem, { kind: "group" }>;
type LinkItemRaw = Extract<TransitItemRaw, { kind: "link" }>;
type GroupItemRaw = Extract<TransitItemRaw, { kind: "group" }>;

interface TransitSectionContext {
  lang: SupportedLang;
  busGroupById: ReadonlyMap<string, BusGroup>;
  stationById: ReadonlyMap<string, ServedStation>;
}

function toBusTransitItem(group: BusGroup): TransitChild {
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

const LINE_NAME_SEPARATOR = " · ";

function toSubwayTransitItem(station: ServedStation, lang: SupportedLang): TransitChild {
  const lines = station.lines.map(({ code, name, color, marker }) => ({
    code,
    name: name[lang],
    color,
    marker: { text: marker.text[lang], color: marker.color },
  }));
  return {
    kind: "subway",
    id: toTransitItemId({ kind: "subway", stationId: station.id }),
    stationId: station.id,
    title: station.title[lang],
    subtitle: lines.map((line) => line.name).join(LINE_NAME_SEPARATOR),
    lines,
    action: { actionType: "route", actionValue: `/subway?station=${station.id}` },
  };
}

function toLinkTransitItem(link: LinkItemRaw, lang: SupportedLang): TransitChild {
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
function toTransitChildren(item: TransitChildRaw, context: TransitSectionContext): TransitChild[] {
  if (item.kind === "link") return [toLinkTransitItem(item, context.lang)];
  if (item.kind === "bus") {
    const group = context.busGroupById.get(item.groupId);
    return group === undefined ? [] : [toBusTransitItem(group)];
  }
  const station = context.stationById.get(item.stationId);
  if (station === undefined) throw new Error(`transit layout places subway station "${item.stationId}", which is not served`);
  return [toSubwayTransitItem(station, context.lang)];
}

function toGroupTransitItems(group: GroupItemRaw, context: TransitSectionContext): TransitItem[] {
  if (group.visibleWith !== undefined && !context.busGroupById.has(group.visibleWith.groupId)) return [];
  const items = group.items.flatMap((child) => toTransitChildren(child, context));
  if (items.length === 0) return [];
  const { lang } = context;
  return [
    {
      kind: "group",
      id: toTransitItemId(group),
      title: toLocalizedText(group.title, lang),
      subtitle: group.subtitle === undefined ? null : toLocalizedText(group.subtitle, lang),
      icon: { type: group.icon.type, color: group.icon.color, text: toLocalizedText(group.icon.text, lang) },
      initialState: group.initialState,
      items,
    },
  ];
}

const toTransitItems = (item: TransitItemRaw, context: TransitSectionContext): TransitItem[] =>
  item.kind === "group" ? toGroupTransitItems(item, context) : toTransitChildren(item, context);

export function toTransitSection(section: TransitLayoutRaw["sections"][number], context: TransitSectionContext): TransitSection {
  return {
    type: "item_list",
    id: section.id,
    title: section.title === undefined ? null : toLocalizedText(section.title, context.lang),
    items: section.items.flatMap((item) => toTransitItems(item, context)),
  };
}
