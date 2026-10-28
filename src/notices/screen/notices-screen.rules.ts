import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { NoticeFacts } from "../facts/notices-facts.schema";
import type { FactsSnapshot } from "../notices.document";
import type { ItemReading, RowReading } from "../row/notices-row.types";
import { BLOCK_KEYS, LEADING_BLOCKS, NOTICE_TYPE_BY_CATEGORY, SCREEN_WORDS, STATUS_SPECS } from "./notices-screen.constants";
import type { BarAction, BlockKey, Collapse, HeaderChange, ScreenAction, ScreenScope, ScreenStatus } from "./notices-screen.types";

type Action = NoticeFacts["actions"][number];
type Contact = NoticeFacts["contacts"][number];
type DatedItem = NoticeFacts["times"][number];
type SnapshotItem = FactsSnapshot["times"][number];
type RowKind = RowReading["row"]["status"];
type StoredPlace = DatedItem["where"]["places"][number];

const EVENT_ON_KINDS: ReadonlySet<string> = new Set(["today", "ongoing", "upcoming"]);
const OPEN_WINDOW_KINDS: ReadonlySet<string> = new Set(["open", "ongoing"]);
const PAST_KINDS: ReadonlySet<string> = new Set(["ended", "closed"]);
const OPEN_CALL_KINDS: ReadonlySet<RowKind> = new Set(["open", "extended"]);
// WHY: umbrella ADR 0009 D14: an action with no window counts only while the notice itself is open or still ahead.
const UNWINDOWED_BAR_KINDS: ReadonlySet<RowKind> = new Set(["open", "extended", "ongoing", "today", "upcoming", "nodate"]);
// WHY: a wrong signal is worse than none (D9): no bar over a stated closure, cancellation or suspension, or a date the row abstains on.
const NO_BAR_KINDS: ReadonlySet<RowKind> = new Set(["closed", "ended", "cancelled", "suspended", "abstain"]);
const ADDRESS = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const ADDRESS_IN_TEXT = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_NUMBER = /\d{2,4}-\d{3,4}-\d{4}/;
const HTTP_URL = /^https?:\/\/\S+$/i;
const MAILTO = /^mailto:/i;
const TENTATIVE_TAIL = ` ${SCREEN_WORDS.tentative}`;
const MAP_PLACE_KIND = "skku_building";
const OFF_CAMPUS_REASON = "offcampus";

export function toBlockOrder(category: string | null | undefined, reading: RowReading): BlockKey[] {
  if (reading.isStaffOnly) return [];
  const leading = LEADING_BLOCKS[NOTICE_TYPE_BY_CATEGORY.get(category ?? "") ?? "event"];
  const changed: BlockKey[] = reading.facts.statedChanges.length > 0 ? ["change"] : [];
  return [...new Set<BlockKey>([...changed, ...leading, ...BLOCK_KEYS])];
}

export function toStatusLine(reading: RowReading): ScreenStatus | null {
  const { row } = reading;
  const spec = STATUS_SPECS[row.status];
  if (reading.isStaffOnly || !spec) return null;
  const tone = row.urgent && OPEN_CALL_KINDS.has(row.status) ? "soon" : spec.tone;
  const detail = toStatusDetail(reading, spec.word);
  return { word: spec.word, tone, detail: detail === "" ? null : detail };
}

function toStatusDetail(reading: RowReading, word: string): string {
  const { row } = reading;
  if (row.status === "closed" && isEventOn(reading)) return toEventOnDetail(reading);
  return withoutWord(hasFirstCome(reading) ? joinParts(row.line2, SCREEN_WORDS.firstCome) : row.line2, word);
}

// WHY: umbrella ADR 0009 D12 and its 2026-10-28 amendment: a closed sign-up whose event is still on reads closed, and the detail says the event part only.
function toEventOnDetail({ eventStatus, items }: RowReading): string {
  const event = "item" in eventStatus ? items.find(({ item }) => item === eventStatus.item) : undefined;
  return eventStatus.kind === "ongoing" ? joinParts(SCREEN_WORDS.ongoing, event?.line ?? "") : (event?.line ?? "");
}

const isEventOn = ({ eventStatus }: RowReading): boolean => EVENT_ON_KINDS.has(eventStatus.kind);

function hasFirstCome({ facts, row }: RowReading): boolean {
  const isShownWindow = (action: Action): boolean => action.window === "" || action.window === row.itemId;
  return OPEN_CALL_KINDS.has(row.status) && facts.actions.some((action) => isStated(action) && action.firstCome !== null && isShownWindow(action));
}

// WHY: the word leads the line, so a detail part that opens or ends with it (the row's today, closed) drops it.
function withoutWord(detail: string, word: string): string {
  const lead = `${word} `;
  const trail = ` ${word}`;
  const strip = (part: string): string => {
    if (part === word) return "";
    if (part.startsWith(lead)) return part.slice(lead.length);
    return part.endsWith(trail) ? part.slice(0, -trail.length) : part;
  };
  return joinParts(...detail.split(" · ").map(strip));
}

export function toCollapse(reading: RowReading): Collapse {
  if (reading.isStaffOnly) return null;
  if (reading.row.status === "cancelled") return "cancelled";
  return (reading.row.status === "closed" || reading.row.status === "ended") && !isEventOn(reading) ? "closed" : null;
}

export function toBarAction(reading: RowReading): BarAction | null {
  if (reading.isStaffOnly || NO_BAR_KINDS.has(reading.row.status)) return null;
  const open = reading.facts.actions.filter((action) => isStated(action) && isOpenNow(action, reading));
  const bars = open.flatMap((action): BarAction[] => {
    const target = toActionTarget(action, reading.facts);
    return target?.kind === "link" || target?.kind === "email" ? [{ label: action.verb.quote, kind: target.kind, target: target.target }] : [];
  });
  const distinct = bars.filter((bar, at) => bars.findIndex(({ kind, target }) => kind === bar.kind && target === bar.target) === at);
  return distinct.length === 1 ? (distinct[0] ?? null) : null;
}

function isOpenNow(action: Action, { row, items }: RowReading): boolean {
  if (action.window === "") return UNWINDOWED_BAR_KINDS.has(row.status);
  return items.some(({ item, status }) => item.id === action.window && OPEN_WINDOW_KINDS.has(status));
}

export function toActionTarget(action: Action, facts: NoticeFacts): ScreenAction | null {
  if (action.method === "phone") return toCallTarget(action.target);
  if (action.method === "email") return toEmailTarget(action.target);
  return action.method === "link" ? toLinkTarget(facts.sources.links.find((link) => link.id === action.target)?.url ?? "") : null;
}

function toLinkTarget(url: string): ScreenAction | null {
  if (MAILTO.test(url)) return toEmailTarget(url.replace(MAILTO, "").split("?")[0] ?? "");
  return HTTP_URL.test(url) ? { kind: "link", target: url } : null;
}

// WHY: a contact's value is its quote, words and all, so the target is the number or the address inside it (umbrella ADR 0009 D13: tap to call or email).
export function toContactAction({ kind, value }: Contact): ScreenAction | null {
  const target = (kind === "phone" ? PHONE_NUMBER : ADDRESS_IN_TEXT).exec(value.quote)?.[0];
  return target ? { kind: kind === "phone" ? "call" : "email", target } : null;
}

// CONTRACT(skkuverse-crawler): a place written off campus is stored unresolved with this reason
// (skkuverse-crawler/py/src/skkuverse_crawler/plugins/facts/record.py); umbrella ADR 0009 opens it in the phone's map app.
export function toPlaceAction({ text, reason }: StoredPlace, display: PlaceDisplay | undefined): ScreenAction | null {
  if (display?.mapTarget) return { kind: "map", target: `${MAP_PLACE_KIND}:${display.mapTarget.skkuId}`, space: display.mapTarget.spaceCd };
  return reason === OFF_CAMPUS_REASON && text !== "" ? { kind: "search", target: text } : null;
}

const toCallTarget = (text: string): ScreenAction | null => {
  const number = PHONE_NUMBER.exec(text)?.[0];
  return number ? { kind: "call", target: number } : null;
};

const toEmailTarget = (address: string): ScreenAction | null => (ADDRESS.test(address) ? { kind: "email", target: address } : null);

export function toFirstSeen(firstSeenAt: Date, reading: RowReading): string {
  const day = reading.dayOffset(firstSeenAt) === -1 ? SCREEN_WORDS.yesterday : (reading.dayText(firstSeenAt) ?? "");
  return SCREEN_WORDS.firstSeen.replace("{day}", day);
}

export function toHeaderChange({ reading, displayByPlaceId }: ScreenScope): HeaderChange | null {
  const snapshotItems = reading.factsHistory.at(-1)?.times ?? [];
  const isPairable = (id: string): boolean => [snapshotItems, reading.facts.times].every((times) => times.filter((item) => item.id === id).length === 1);
  const pairs = reading.facts.times.flatMap((item) => (isPairable(item.id) ? snapshotItems.filter((was) => was.id === item.id).map((was) => ({ item, was })) : []));
  const dates = pairs.map(({ item, was }) => toDateChange(item, was, reading));
  const places = pairs.map(({ item, was }) => toPlaceChange(item, was, displayByPlaceId));
  return dates.find((change) => change !== null) ?? places.find((change) => change !== null) ?? null;
}

function toDateChange(item: DatedItem, was: SnapshotItem, reading: RowReading): HeaderChange | null {
  if (item.start.date === was.start && item.end.date === was.end) return null;
  const before = toRangeText(was.start, was.end, reading);
  const after = toRangeText(item.start.date, item.end.date, reading);
  return before && after ? { what: SCREEN_WORDS.date, before, after } : null;
}

function toPlaceChange(item: DatedItem, was: SnapshotItem, displayByPlaceId: ReadonlyMap<string, PlaceDisplay>): HeaderChange | null {
  const now = item.where.places.map((place) => place.id);
  if (now.join("|") === was.places.join("|")) return null;
  const before = toPlaceNames(was.places, displayByPlaceId);
  const after = toPlaceNames(now, displayByPlaceId);
  return before && after ? { what: SCREEN_WORDS.place, before, after } : null;
}

function toPlaceNames(placeIds: readonly string[], displayByPlaceId: ReadonlyMap<string, PlaceDisplay>): string | null {
  const displays = placeIds.flatMap((placeId) => displayByPlaceId.get(placeId) ?? []);
  return displays.length > 0 && displays.length === placeIds.length ? displays.map(toPlaceText).join(", ") : null;
}

function toRangeText(start: string, end: string, reading: RowReading): string | null {
  const [from, to] = [start ? reading.dayText(start) : null, end ? reading.dayText(end) : null];
  return from && to && start !== end ? `${from}~${to}` : (from ?? to);
}

export function toPlaceIds(reading: RowReading): string[] {
  const current = reading.facts.times.flatMap((item) => item.where.places.map((place) => place.id));
  const before = (reading.factsHistory.at(-1)?.times ?? []).flatMap((item) => item.places);
  return [...new Set([...current, ...before])].filter((placeId) => placeId !== "unresolved");
}

export function toDisplayByPlaceId(placeIds: readonly string[], displays: ReadonlyArray<PlaceDisplay | null>): ReadonlyMap<string, PlaceDisplay> {
  return new Map(
    placeIds.flatMap((placeId, position) => {
      const display = displays[position];
      return display ? [[placeId, display] as const] : [];
    }),
  );
}

export function toSessionOrder(readings: readonly ItemReading[]): ItemReading[] {
  const isPast = ({ status }: ItemReading): boolean => PAST_KINDS.has(status);
  const dayOf = ({ item }: ItemReading): string => item.start.date || item.end.date;
  const upcoming = readings.filter((reading) => !isPast(reading)).sort((left, right) => dayOf(left).localeCompare(dayOf(right)));
  const past = readings.filter(isPast).sort((left, right) => dayOf(right).localeCompare(dayOf(left)));
  return [...upcoming, ...past];
}

export function toItemText({ item, line }: ItemReading): string {
  if (item.dateWarnings.length > 0) return withTag(item, item.ev.quote);
  const isVerbShown = item.kind === "window" || item.verb === "" || line.includes(item.verb);
  return withTag(item, isVerbShown ? line : withVerb(line, item.verb));
}

// WHY: umbrella ADR 0009 D4's example of a tentative date puts the verb before the tentative word, never after it.
const withVerb = (line: string, verb: string): string =>
  line.endsWith(TENTATIVE_TAIL) ? `${line.slice(0, -TENTATIVE_TAIL.length)} ${verb}${TENTATIVE_TAIL}` : `${line} ${verb}`;

export const isStated = ({ disputed }: { disputed?: boolean }): boolean => disputed !== true;

export const isFromPoster = ({ src }: { src: string }): boolean => src.startsWith("poster:");

export const isPosterOnly = ({ times }: NoticeFacts): boolean => times.length > 0 && times.every((item) => isFromPoster(item.ev));

// WHY: umbrella ADR 0009 D13: a track's fact shows its tag first, as the row writes `[tag] text`.
export const withTag = ({ tag }: { tag?: string }, text: string): string => (tag ? `[${tag}] ${text}` : text);

// WHY: umbrella ADR 0009 D5 and D13: a draw is always marked as one.
export const withDraw = ({ isDraw, ev }: NoticeFacts["benefits"][number]): string =>
  isDraw && !ev.quote.includes(SCREEN_WORDS.draw) ? `${ev.quote} (${SCREEN_WORDS.draw})` : ev.quote;

export const toPlaceText = ({ name, code }: PlaceDisplay): string => (code ? `${name} ${code}` : name);

const joinParts = (...parts: string[]): string => parts.filter((part) => part !== "").join(" · ");
