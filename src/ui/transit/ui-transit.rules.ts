import { isBrokenLinkAction } from "../../shared/link-action.util";
import { toMiniAppTargetReferences } from "../ui.rules";
import type { TargetGrammar } from "../ui.types";
import type { TransitItemRaw, TransitLayoutRaw } from "./ui-transit.schema";
import type { TransitLayoutIssue, TransitLayoutReference, TransitLayoutReferences } from "./ui-transit.types";

type TransitItemReference =
  | { kind: "bus"; groupId: string }
  | { kind: "subway"; stationId: string }
  | { kind: "link"; id: string }
  | { kind: "group"; id: string };

export function toTransitItemId(reference: TransitItemReference): string {
  if (reference.kind === "bus") return `bus:${reference.groupId}`;
  if (reference.kind === "subway") return `subway:${reference.stationId}`;
  if (reference.kind === "group") return `group:${reference.id}`;
  return reference.id;
}

interface Located<T> {
  at: TransitLayoutIssue["path"];
  value: T;
  sectionId: string;
}

const itemsOf = (layout: TransitLayoutRaw): Array<Located<TransitItemRaw>> =>
  layout.sections.flatMap((section, sectionIndex) =>
    section.items.flatMap((value, itemIndex) => {
      const at = ["sections", sectionIndex, "items", itemIndex];
      const children = value.kind === "group" ? value.items.map((child, k) => ({ at: [...at, "items", k], value: child, sectionId: section.id })) : [];
      return [{ at, value, sectionId: section.id }, ...children];
    }),
  );

function visibleWithIssue({ at, value, sectionId }: Located<TransitItemRaw>, items: ReadonlyArray<Located<TransitItemRaw>>, references: TransitLayoutReferences): TransitLayoutIssue | null {
  if (value.kind !== "group" || value.visibleWith === undefined) return null;
  const { groupId } = value.visibleWith;
  const issueAt = [...at, "visibleWith", "groupId"];
  if (!references.busGroupIds.includes(groupId)) return { path: issueAt, message: `"${groupId}" is not a bus group` };
  // WHY: the app draws a group under the bus row it follows, so the two must share a section.
  const isPlacedBeside = items.some((item) => item.sectionId === sectionId && item.value.kind === "bus" && item.value.groupId === groupId);
  return isPlacedBeside ? null : { path: issueAt, message: `bus group "${groupId}" is not placed in section "${sectionId}"` };
}

function referenceIssue({ at, value }: Located<TransitItemRaw>, references: TransitLayoutReferences): TransitLayoutIssue | null {
  if (value.kind === "bus" && !references.busGroupIds.includes(value.groupId)) return { path: [...at, "groupId"], message: `"${value.groupId}" is not a bus group` };
  if (value.kind === "subway" && !references.stationIds.includes(value.stationId)) return { path: [...at, "stationId"], message: `"${value.stationId}" is not a served subway station` };
  if (value.kind !== "link" || !isBrokenLinkAction(value, references.registry)) return null;
  return { path: [...at, "actionValue"], message: `"${value.id}" actionValue "${value.actionValue}" is not valid for "${value.actionType}"` };
}

// WHY: a group meant to be hidden uses its `visibility`; an omission would show it on /ui/home/transitlist and not here.
function unplacedIssues(items: readonly TransitItemRaw[], references: TransitLayoutReferences): TransitLayoutIssue[] {
  const placedGroupIds = new Set(items.flatMap((item) => (item.kind === "bus" ? [item.groupId] : [])));
  const placedStationIds = new Set(items.flatMap((item) => (item.kind === "subway" ? [item.stationId] : [])));
  return [
    ...references.busGroupIds.filter((id) => !placedGroupIds.has(id)).map((id) => `bus group "${id}" is not placed`),
    ...references.stationIds.filter((id) => !placedStationIds.has(id)).map((id) => `subway station "${id}" is not placed`),
  ].map((message) => ({ path: ["sections"], message }));
}

export function toTransitLayoutIssues(layout: TransitLayoutRaw, references: TransitLayoutReferences): TransitLayoutIssue[] {
  const items = itemsOf(layout);
  const itemIssues = items.flatMap((item) => referenceIssue(item, references) ?? visibleWithIssue(item, items, references) ?? []);
  return [...itemIssues, ...unplacedIssues(items.map((item) => item.value), references)];
}

function itemReferences({ at, value }: Located<TransitItemRaw>, grammar: TargetGrammar): TransitLayoutReference[] {
  if (value.kind === "bus") return [{ dataset: "busGroups", id: value.groupId, path: [...at, "groupId"] }];
  if (value.kind === "subway") return [{ dataset: "subwayStations", id: value.stationId, path: [...at, "stationId"] }];
  if (value.kind === "link") return toMiniAppTargetReferences(value, [...at, "actionValue"], grammar);
  return value.visibleWith === undefined ? [] : [{ dataset: "busGroups", id: value.visibleWith.groupId, path: [...at, "visibleWith", "groupId"] }];
}

export function transitLayoutReferences(layout: TransitLayoutRaw, grammar: TargetGrammar): TransitLayoutReference[] {
  return itemsOf(layout).flatMap((item) => itemReferences(item, grammar));
}

interface UnresolvedItem {
  section: number;
  item: number;
  child?: number;
}

const isUnplacedIssue = ({ path }: TransitLayoutIssue): boolean => path.length === 1 && path[0] === "sections";

function toUnresolvedItem({ path }: TransitLayoutIssue): UnresolvedItem {
  const [root, section, list, item, childList, child] = path;
  if (root !== "sections" || typeof section !== "number" || list !== "items" || typeof item !== "number") throw new Error(`transit layout issue path ${path.join(".")} names no item`);
  return childList === "items" && typeof child === "number" ? { section, item, child } : { section, item };
}

export function withoutUnresolvedItems(layout: TransitLayoutRaw, issues: readonly TransitLayoutIssue[]): TransitLayoutRaw {
  const unresolved = issues.filter((issue) => !isUnplacedIssue(issue)).map(toUnresolvedItem);
  const isUnresolved = (section: number, item: number, child?: number): boolean => unresolved.some((u) => u.section === section && u.item === item && u.child === child);
  const sections = layout.sections.flatMap((section, sectionIndex) => {
    const items = section.items.flatMap((item, itemIndex): TransitItemRaw[] => {
      if (isUnresolved(sectionIndex, itemIndex)) return [];
      if (item.kind !== "group") return [item];
      const children = item.items.filter((_, k) => !isUnresolved(sectionIndex, itemIndex, k));
      return children.length === 0 ? [] : [{ ...item, items: children }];
    });
    return items.length === 0 ? [] : [{ ...section, items }];
  });
  return { ...layout, sections };
}
