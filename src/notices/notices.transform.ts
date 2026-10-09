/**
 * Pure transform functions for notice documents.
 *
 * Invariants:
 * - Empty-string category/author → null
 * - cleanMarkdown (GFM) → contentMarkdown, null fallback (detail only)
 * - contentHash != null → hasContent: true (list)
 * - editCount > 0 → isEdited (list) / editInfo (detail)
 * - summaryAt missing/null → summary: null
 * - unknown summaryType → "informational"
 * - List summary is brief (4 fields: oneLiner/type/startAt/endAt); detail summary
 *   is full (incl. `text`, not `body`).
 * - Brief's startAt/endAt are derived by selectEffectivePeriod (type-aware):
 *     action_required → best-pick among endDate-bearing periods, excluding
 *       same-day time-boxed events (startDate==endDate && endTime!=null);
 *       future-first (earliest upcoming endDateTime; fall back to most-recently
 *       passed). KST-fixed datetime comparison.
 *     event / informational → periods[0] passthrough.
 *   endAt.label is the selected period's label (or null). startAt carries the
 *   selected period's start, and is meaningful primarily for informational
 *   range-state UI; action_required clients should ignore startAt.
 * - v2 notices (summaryVersion >= 2 with summaryDates) take the brief from
 *   selectRoleBadge instead: application windows → due → happens → closed →
 *   runs (skkuverse-ai refine-notice-summary-v2 design D11). The brief keeps the
 *   v1 shape, and `type` is chosen so the app's formatDeadlineBadge renders it
 *   as is; the stored summaryType is not consulted.
 */
import moment from "moment-timezone";
import type { NoticeDoc, SummaryDate, SummaryPeriod } from "./types";

const VALID_SUMMARY_TYPES: ReadonlySet<string> = new Set([
  "action_required",
  "event",
  "informational",
]);
const TIMEZONE = "Asia/Seoul";

type SummaryType = "action_required" | "event" | "informational";

function normalizeSummaryType(t: unknown): SummaryType {
  return VALID_SUMMARY_TYPES.has(t as string)
    ? (t as SummaryType)
    : "informational";
}

/**
 * Compute the KST wall-clock epoch ms for a period's effective deadline.
 * endDate is required (caller must filter). endTime falls back to 23:59:59.
 */
function periodEndEpochMs(period: SummaryPeriod): number {
  const time = period.endTime || "23:59:59";
  return moment.tz(`${period.endDate}T${time}`, TIMEZONE).valueOf();
}

/**
 * Select the "effective" period for list-cell badge rendering.
 */
function selectEffectivePeriod(
  periods: unknown,
  type: SummaryType,
  now: Date,
): SummaryPeriod | null {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  const periodsArr = periods as SummaryPeriod[];

  if (type !== "action_required") {
    // event / informational: trust AI's periods[0] ordering.
    // periods.length >= 1 guaranteed by above guard, so [0]! is safe.
    return periodsArr[0]!;
  }

  // action_required: best-pick with rule (a) exclusion.
  const candidates = periodsArr.filter((p) => {
    if (!p || !p.endDate) return false;
    // Rule (a): same-day time-boxed event (설명회 12:00~13:00, 인터뷰 슬롯)
    if (p.startDate && p.startDate === p.endDate && p.endTime) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  const nowMs = now.getTime();
  const withEpoch = candidates.map((p) => ({ p, t: periodEndEpochMs(p) }));

  const future = withEpoch
    .filter((x) => x.t >= nowMs)
    .sort((a, b) => a.t - b.t);
  if (future.length > 0) return future[0]!.p;

  // All past: return most recently passed (for "closed" badge).
  withEpoch.sort((a, b) => b.t - a.t);
  return withEpoch[0]!.p;
}

interface SummaryBrief {
  oneLiner: string | null;
  type: SummaryType;
  startAt: { date: string | null; time: string | null } | null;
  endAt: {
    date: string | null;
    time: string | null;
    label: string | null;
  } | null;
}

// --- v2 brief: role-based badge ---

type BriefDates = Pick<SummaryBrief, "type" | "startAt" | "endAt">;

/** An open-ended application window keeps its (badge-less) slot this long. */
const OPEN_ENDED_DAYS = 30;

interface Span {
  start: moment.Moment | null;
  end: moment.Moment | null;
}

interface DateSpan extends Span {
  role: SummaryDate["role"];
  subject: string | null;
}

interface WindowSpan extends Span {
  openEnded: boolean;
}

function parseKst(value: unknown): moment.Moment | null {
  if (typeof value !== "string" || value === "") return null;
  const m = moment.tz(value, moment.ISO_8601, true, TIMEZONE);
  return m.isValid() ? m : null;
}

function objects(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (x): x is Record<string, unknown> => x !== null && typeof x === "object",
  );
}

function toDateSpans(dates: unknown): DateSpan[] {
  return objects(dates)
    .map((d) => ({
      start: parseKst(d.startAt),
      end: parseKst(d.endAt),
      role: typeof d.role === "string" ? d.role : "",
      subject:
        typeof d.subject === "string" && d.subject !== "" ? d.subject : null,
    }))
    .filter((d) => d.start || d.end);
}

function toWindowSpans(application: unknown): WindowSpan[] {
  const windows =
    application !== null && typeof application === "object"
      ? (application as { windows?: unknown }).windows
      : null;
  return objects(windows)
    .map((w) => ({
      start: parseKst(w.startAt),
      end: parseKst(w.endAt),
      openEnded: w.openEnded === true,
    }))
    .filter((w) => w.start || w.end)
    .sort((a, b) => (a.end ?? a.start)!.valueOf() - (b.end ?? b.start)!.valueOf());
}

/** A start at 00:00 has no time of its own. */
function startToBrief(m: moment.Moment): NonNullable<SummaryBrief["startAt"]> {
  const time = m.format("HH:mm");
  return { date: m.format("YYYY-MM-DD"), time: time === "00:00" ? null : time };
}

/**
 * v2 stores an end with no time (or midnight, 24:00) as the next day's 00:00.
 * The app reads a null time as the end of that day, so give it the day before.
 */
function endToBrief(
  m: moment.Moment,
  label: string | null,
): NonNullable<SummaryBrief["endAt"]> {
  if (m.format("HH:mm") === "00:00") {
    return {
      date: m.clone().subtract(1, "day").format("YYYY-MM-DD"),
      time: null,
      label,
    };
  }
  return { date: m.format("YYYY-MM-DD"), time: m.format("HH:mm"), label };
}

function sameInstant(a: moment.Moment | null, b: moment.Moment | null): boolean {
  return a === null ? b === null : b !== null && a.valueOf() === b.valueOf();
}

/** The subject of the dated element a window was built from (windowRefs). */
function windowLabel(w: WindowSpan, dates: DateSpan[]): string | null {
  const exact = dates.find(
    (d) => sameInstant(d.start, w.start) && sameInstant(d.end, w.end),
  );
  const byEnd = w.end ? dates.find((d) => sameInstant(d.end, w.end)) : undefined;
  return (exact ?? byEnd)?.subject ?? null;
}

function earliest<T>(items: T[], key: (item: T) => moment.Moment): T | undefined {
  let best: T | undefined;
  let bestMs = Infinity;
  for (const item of items) {
    const ms = key(item).valueOf();
    if (ms < bestMs) {
      best = item;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Pick the list-cell badge for a v2 notice, as the v1 brief fields.
 *
 * Priority (first match wins):
 *  a. application windows, by end: upcoming → informational range
 *     ("D-n · 시작까지"; a one-day window → event D-n), open → action_required
 *     to its end with the subject as label, open-ended → action_required with
 *     no end (no badge) for OPEN_ENDED_DAYS after it opens.
 *  b. the earliest future `due` end → action_required.
 *  c. the earliest future `happens` → event. A one-day event drops its end so
 *     the app counts to the start.
 *  d. windows or `due` existed but all passed → action_required at the latest
 *     past end ("마감").
 *  e. a multi-day `runs` range not yet over → informational, in-progress first.
 *  f. nothing → informational with no dates (no badge).
 */
function selectRoleBadge(
  application: unknown,
  dates: unknown,
  now: Date,
): BriefDates {
  const nowMs = now.getTime();
  const spans = toDateSpans(dates);
  const windows = toWindowSpans(application);

  for (const w of windows) {
    if (w.start && nowMs < w.start.valueOf()) {
      const startAt = startToBrief(w.start);
      if (w.end) {
        const endAt = endToBrief(w.end, windowLabel(w, spans));
        if (endAt.date !== startAt.date) {
          return { type: "informational", startAt, endAt };
        }
      }
      return { type: "event", startAt, endAt: null };
    }
    if (w.end && nowMs < w.end.valueOf()) {
      return {
        type: "action_required",
        startAt: w.start ? startToBrief(w.start) : null,
        endAt: endToBrief(w.end, windowLabel(w, spans)),
      };
    }
    if (
      !w.end &&
      w.openEnded &&
      w.start &&
      nowMs < w.start.clone().add(OPEN_ENDED_DAYS, "days").valueOf()
    ) {
      return { type: "action_required", startAt: startToBrief(w.start), endAt: null };
    }
  }

  const dues = spans.filter((d) => d.role === "due");
  const nextDue = earliest(
    dues.filter((d) => d.end !== null && nowMs < d.end.valueOf()),
    (d) => d.end!,
  );
  if (nextDue) {
    return {
      type: "action_required",
      startAt: nextDue.start ? startToBrief(nextDue.start) : null,
      endAt: endToBrief(nextDue.end!, nextDue.subject),
    };
  }

  const nextEvent = earliest(
    spans.filter((d) => d.role === "happens" && nowMs < (d.end ?? d.start)!.valueOf()),
    (d) => (d.start ?? d.end)!,
  );
  if (nextEvent) {
    if (!nextEvent.start) {
      return {
        type: "event",
        startAt: null,
        endAt: endToBrief(nextEvent.end!, nextEvent.subject),
      };
    }
    const startAt = startToBrief(nextEvent.start);
    const endAt = nextEvent.end ? endToBrief(nextEvent.end, nextEvent.subject) : null;
    return {
      type: "event",
      startAt,
      endAt: endAt && endAt.date !== startAt.date ? endAt : null,
    };
  }

  if (windows.length > 0 || dues.length > 0) {
    let latest: moment.Moment | null = null;
    for (const x of [...windows, ...dues]) {
      if (x.end && (!latest || x.end.valueOf() > latest.valueOf())) latest = x.end;
    }
    return {
      type: "action_required",
      startAt: null,
      endAt: latest ? endToBrief(latest, null) : null,
    };
  }

  const ranges = spans.filter(
    (d) =>
      d.role === "runs" &&
      d.start !== null &&
      d.end !== null &&
      nowMs < d.end.valueOf() &&
      startToBrief(d.start).date !== endToBrief(d.end, null).date,
  );
  const range =
    earliest(
      ranges.filter((d) => d.start!.valueOf() <= nowMs),
      (d) => d.end!,
    ) ?? earliest(ranges, (d) => d.start!);
  if (range) {
    return {
      type: "informational",
      startAt: startToBrief(range.start!),
      endAt: endToBrief(range.end!, range.subject),
    };
  }

  return { type: "informational", startAt: null, endAt: null };
}

function isV2Summary(doc: NoticeDoc): boolean {
  return (
    typeof doc.summaryVersion === "number" &&
    doc.summaryVersion >= 2 &&
    Array.isArray(doc.summaryDates)
  );
}

function buildSummaryBrief(
  doc: NoticeDoc,
  now: Date = new Date(),
): SummaryBrief | null {
  if (!doc.summaryAt) return null;
  if (isV2Summary(doc)) {
    return {
      oneLiner: doc.summaryOneLiner || null,
      ...selectRoleBadge(doc.summaryApplication, doc.summaryDates, now),
    };
  }
  const periods = Array.isArray(doc.summaryPeriods) ? doc.summaryPeriods : [];
  const type = normalizeSummaryType(doc.summaryType);
  const selected = selectEffectivePeriod(periods, type, now);

  const startAt =
    selected && (selected.startDate || selected.startTime)
      ? { date: selected.startDate || null, time: selected.startTime || null }
      : null;

  const endAt =
    selected && (selected.endDate || selected.endTime)
      ? {
          date: selected.endDate || null,
          time: selected.endTime || null,
          label: selected.label || null,
        }
      : null;

  return {
    oneLiner: doc.summaryOneLiner || null,
    type,
    startAt,
    endAt,
  };
}

interface SummaryFull {
  text: string | null;
  oneLiner: string | null;
  type: SummaryType;
  periods: SummaryPeriod[];
  locations: unknown[];
  details: unknown;
  model: string | null;
  generatedAt: NoticeDoc["summaryAt"];
}

function buildSummaryFull(doc: NoticeDoc): SummaryFull | null {
  if (!doc.summaryAt) return null;
  return {
    text: doc.summary || null,
    oneLiner: doc.summaryOneLiner || null,
    type: normalizeSummaryType(doc.summaryType),
    periods: Array.isArray(doc.summaryPeriods) ? doc.summaryPeriods : [],
    locations: Array.isArray(doc.summaryLocations) ? doc.summaryLocations : [],
    details: doc.summaryDetails || null,
    model: doc.summaryModel || null,
    generatedAt: doc.summaryAt,
  };
}

function toListItem(doc: NoticeDoc, now: Date = new Date()) {
  return {
    id: doc._id.toHexString(),
    sourceId: doc.sourceId,
    articleNo: doc.articleNo,
    title: doc.title,
    category: doc.category || null,
    author: doc.author || null,
    department: doc.department || null,
    date: doc.date,
    views: doc.views ?? 0,
    sourceUrl: doc.sourceUrl,
    hasContent: doc.contentHash != null,
    hasAttachments:
      Array.isArray(doc.attachments) && doc.attachments.length > 0,
    isEdited: (doc.editCount || 0) > 0,
    summary: buildSummaryBrief(doc, now),
  };
}

function toDetailItem(doc: NoticeDoc) {
  return {
    id: doc._id.toHexString(),
    sourceId: doc.sourceId,
    articleNo: doc.articleNo,
    title: doc.title,
    category: doc.category || null,
    author: doc.author || null,
    department: doc.department || null,
    date: doc.date,
    views: doc.views ?? 0,
    contentMarkdown: doc.cleanMarkdown ?? null,
    attachments: (doc.attachments || []).map((a) => {
      const att: { name: string; url: string; referer?: string } = {
        name: a.name,
        url: a.url,
      };
      if (a.referer) att.referer = a.referer;
      return att;
    }),
    sourceUrl: doc.sourceUrl,
    lastModified: doc.lastModified || null,
    crawledAt: doc.crawledAt,
    editInfo:
      (doc.editCount || 0) > 0
        ? { count: doc.editCount, history: doc.editHistory || [] }
        : null,
    summary: buildSummaryFull(doc),
  };
}

export {
  VALID_SUMMARY_TYPES,
  normalizeSummaryType,
  selectEffectivePeriod,
  selectRoleBadge,
  buildSummaryBrief,
  buildSummaryFull,
  toListItem,
  toDetailItem,
};
