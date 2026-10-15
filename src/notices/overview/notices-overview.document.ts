import type { NoticeDoc } from "../notices.document";

export type OverviewCandidate = Pick<
  NoticeDoc,
  "_id" | "sourceId" | "articleNo" | "title" | "date" | "department" | "category" | "summary" | "summaryOneLiner" | "summaryType"
  | "summaryPeriods" | "summaryLocations" | "summaryDetails" | "contentText" | "contentHash" | "summaryContentHash" | "summaryApplication"
>;
