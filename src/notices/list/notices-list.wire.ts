import { z } from "zod";
import { SUMMARY_TYPES } from "../notices.constants";
import { LIST_DAYS } from "./notices-list.constants";

const briefDate = z.object({ date: z.string().nullable(), time: z.string().nullable() });

const noticeSummaryBrief = z.object({
  oneLiner: z.string().nullable(),
  type: z.enum(SUMMARY_TYPES),
  /** WHY: meaningful for informational ranges; an action_required client reads only `endAt`. */
  startAt: briefDate.nullable(),
  endAt: briefDate.extend({ label: z.string().nullable() }).nullable(),
});

// CONTRACT(skkuverse-app): the names of `SketchRow` (skkuverse-app/apps/mobile/src/dev/notice-sketch/notice-sketch.types.ts); a part
// the notice lacks is null, as in every other list field. Every string is finished Korean text, whatever the language.
const noticeItemRow = z.object({
  token: z.object({ text: z.string(), tone: z.enum(["urgent", "today", "cancelled", "closed", "stopped", "postponed", "extended", "changed"]) }).nullable(),
  title: z.string(),
  when: z.string(),
  urgent: z.boolean(),
  dateMark: z.enum(["warning", "abstain"]).nullable(),
  qualifier: z.string().nullable(),
  /** WHY: only a multi-source list names the board; a list of one board already says which. */
  board: z.string().nullable(),
  dimmed: z.boolean(),
  day: z.enum(LIST_DAYS),
});

const noticeListItem = z.object({
  id: z.string(),
  sourceId: z.string(),
  articleNo: z.number(),
  title: z.string(),
  category: z.string().nullable(),
  author: z.string().nullable(),
  department: z.string().nullable(),
  date: z.string(),
  views: z.number(),
  sourceUrl: z.string(),
  hasContent: z.boolean(),
  hasAttachments: z.boolean(),
  isEdited: z.boolean(),
  summary: noticeSummaryBrief.nullable(),
  /** WHY: null when the notice has no facts or its facts were refused; a client then reads `summary` alone. */
  row: noticeItemRow.nullable(),
});

export const noticeList = z.object({
  notices: z.array(noticeListItem),
  /** WHY: opaque to the app: base64url of the last row's (date, _id), handed back as `cursor`. */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const noticeListMeta = z.object({ count: z.number() });

export type NoticeSummaryBrief = z.input<typeof noticeSummaryBrief>;
export type NoticeItemRow = z.input<typeof noticeItemRow>;
export type NoticeListItem = z.input<typeof noticeListItem>;
export type NoticeList = z.input<typeof noticeList>;
export type NoticeListMeta = z.input<typeof noticeListMeta>;
