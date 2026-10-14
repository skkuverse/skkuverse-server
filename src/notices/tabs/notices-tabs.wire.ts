import { z } from "zod";

const fixedTab = z.object({
  key: z.string(),
  label: z.string(),
  tabMode: z.literal("fixed"),
  fixed: z.object({ sourceId: z.string(), name: z.string(), campus: z.string().nullable() }),
});

const pickerSource = z.object({
  id: z.string(),
  name: z.string(),
  campus: z.string().nullable(),
  college: z.string().nullable(),
  /** WHY: the crawler's `crawlAvailable`, under the name the app reads. */
  noticeAvailable: z.boolean(),
  /** WHY: an i18n key (`loginRequired`); `excludeReasonText` is its copy in the request's language. */
  excludeReason: z.string().nullable(),
  excludeReasonText: z.string().nullable(),
});

const pickerTab = z.object({
  key: z.string(),
  label: z.string(),
  tabMode: z.literal("picker"),
  picker: z.object({
    sources: z.array(pickerSource),
    maxSelection: z.number(),
    defaultIds: z.array(z.string()),
    campusDefaultIds: z.object({ hssc: z.array(z.string()).optional(), nsc: z.array(z.string()).optional() }),
  }),
});

const noticeTab = z.discriminatedUnion("tabMode", [fixedTab, pickerTab]);

export const noticeTabs = z.object({
  schemaVersion: z.literal(1),
  tabs: z.array(noticeTab),
});

export type NoticeTab = z.input<typeof noticeTab>;
export type NoticeTabs = z.input<typeof noticeTabs>;
