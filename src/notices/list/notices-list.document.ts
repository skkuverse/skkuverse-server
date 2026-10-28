import type { NoticeDoc } from "../notices.document";

export type NoticeListRow = Pick<
  NoticeDoc,
  | "_id" | "sourceId" | "articleNo" | "title" | "category" | "author" | "department" | "date" | "views" | "sourceUrl"
  | "attachments" | "contentHash" | "editCount" | "crawledAt" | "summary" | "summaryOneLiner" | "summaryType"
  | "summaryPeriods" | "summaryAt" | "summaryVersion" | "summaryApplication" | "summaryDates"
  | "facts" | "factsHistory" | "dupOf"
>;

export type ClusterMember = Pick<NoticeDoc, "_id" | "dupOf" | "date"> & Partial<Pick<NoticeDoc, "crawledAt">>;
