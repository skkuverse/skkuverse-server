import type { SummaryType } from "../notices.types";
import type { DatedItem, RowItem, RowReading } from "../row/notices-row.types";
import { CONDITION_COUNT_PATTERN, DATELESS_STATUSES, ONE_LINER_SEPARATOR, SPOKEN_TONES } from "./notices-legacy.constants";
import type { DerivedBrief, DerivedBriefDate, DerivedBriefEnd } from "./notices-legacy.types";

type Point = DatedItem["start"];

const toDay = (point: Point): string | null => (point.fuzzy ? point.latest || null : point.date || null);

const toStartAt = (point: Point): DerivedBriefDate | null => (point.date && !point.fuzzy ? { date: point.date, time: point.time || null } : null);

function toEndAt(point: Point): DerivedBriefEnd | null {
  const date = toDay(point);
  return date ? { date, time: point.fuzzy ? null : point.time || null, label: null } : null;
}

function toType(shown: RowItem | null, isDateless: boolean): SummaryType {
  if (shown === null || isDateless) return "informational";
  if (shown.kind === "window") return "action_required";
  return shown.kind === "session" ? "event" : "informational";
}

function toDates(shown: RowItem, type: SummaryType): Pick<DerivedBrief, "startAt" | "endAt"> {
  if (type === "action_required") return { startAt: toStartAt(shown.start), endAt: toEndAt(shown.end) };
  if (type === "event") return { startAt: toStartAt(shown.start), endAt: null };
  const [startAt, endAt] = [toStartAt(shown.start), toEndAt(shown.end)];
  return startAt && endAt && startAt.date !== endAt.date ? { startAt, endAt } : { startAt: null, endAt: null };
}

function toOneLiner({ row, fullQualifier }: RowReading): string | null {
  const word = row.token && SPOKEN_TONES.has(row.token.tone) ? row.token.text : "";
  const qualifier = fullQualifier === null || CONDITION_COUNT_PATTERN.test(fullQualifier) ? "" : fullQualifier;
  return [word, row.trackedLine2, qualifier].filter((part) => part !== "").join(ONE_LINER_SEPARATOR) || null;
}

// WHY: owner decision 2026-10-28: a rough one-liner for apps that still read `summary`: line 2 of the row with its track,
// then its qualifier unfitted, since neither a summary nor a push body has the row's 26 characters. `endAt` is the shown window's end; the type is action_required for a window, event for a session.
export function toDerivedBrief(reading: RowReading): DerivedBrief {
  const { row } = reading;
  const shown = reading.items.find(({ item }) => item.id === row.itemId)?.item ?? null;
  const isDateless = DATELESS_STATUSES.has(row.status);
  const type = toType(shown, isDateless);
  const dates = shown === null || isDateless ? { startAt: null, endAt: null } : toDates(shown, type);
  return { oneLiner: toOneLiner(reading), type, ...dates };
}
