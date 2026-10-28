import { ObjectId, type Document } from "mongodb";
import { escapeRegex } from "../../shared/regex.util";
import type { NoticeListRow } from "./notices-list.document";
import type { CursorPayload, NoticeListQuery, NoticeScope } from "./notices-list.types";

/**
 * EVIDENCE: hinted because prod also holds an undeclared sourceId_1_date_-1 index the planner picks for `$in`,
 * which adds an in-memory SORT; hinting cut multi-source keysExamined 904 → 465 (2026-04-26). A hint against a
 * missing index throws BadValue, so this index stays created while any deployed version hints it.
 */
export const FORCE_INDEX = { sourceId: 1, date: -1, _id: -1 } as const;

export const LIST_SORT = { date: -1, _id: -1 } as const;

// WHY: an inclusion list, so a field the crawler adds later is never served by accident; no body field.
export const LIST_PROJECTION = {
  _id: 1,
  sourceId: 1,
  articleNo: 1,
  title: 1,
  category: 1,
  author: 1,
  department: 1,
  date: 1,
  views: 1,
  sourceUrl: 1,
  attachments: 1,
  contentHash: 1,
  editCount: 1,
  crawledAt: 1,
  summary: 1,
  summaryOneLiner: 1,
  summaryType: 1,
  summaryPeriods: 1,
  summaryAt: 1,
  summaryVersion: 1,
  summaryApplication: 1,
  summaryDates: 1,
  facts: 1,
  factsHistory: 1,
} as const satisfies Record<keyof NoticeListRow, 1>;

// SEE: docs/decisions/0007-notice-ordering-key.md — after the cursor in (date desc, _id desc); `crawledAt` stays out.
export function toCursorFilter(cursor: CursorPayload): Document {
  const oid = new ObjectId(cursor.i);
  return {
    $or: [{ date: { $lt: cursor.d } }, { date: cursor.d, _id: { $lt: oid } }],
  };
}

// WHY: the start-date floor and the cursor both bound `date`, so each clause sits in its own `$and` entry.
export function toNoticeListFilter(scope: NoticeScope, query: NoticeListQuery, serviceStartDate: string): Document {
  const filter: Document = {
    ...(typeof scope === "string" ? { sourceId: scope } : { sourceId: { $in: scope } }),
    isDeleted: { $ne: true },
  };
  if (query.type) filter.summaryType = query.type;
  const clauses: Document[] = [{ date: { $gte: serviceStartDate } }];
  if (query.cursor) clauses.push(toCursorFilter(query.cursor));
  if (query.q) {
    const pattern = escapeRegex(query.q);
    clauses.push({ $or: [{ title: { $regex: pattern, $options: "i" } }, { summaryOneLiner: { $regex: pattern, $options: "i" } }] });
  }
  filter.$and = clauses;
  return filter;
}
