import type { ObjectId } from "mongodb";

export interface SummaryPeriod {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  label?: string;
}

// QUIRK(skkuverse-ai): v2 times are ISO 8601 with +09:00, and an end with no time is the next day's 00:00.
export interface SummaryApplicationWindow {
  startAt: string | null;
  endAt: string | null;
  openEnded: boolean;
}

export interface SummaryApplication {
  status: string;
  windows: SummaryApplicationWindow[];
}

// QUIRK(skkuverse-ai): `role` and `endType` are open enums; an unknown value is ignored, never an error.
export interface SummaryDate {
  evidence: string;
  subject: string;
  role: string;
  endType: string;
  startAt: string | null;
  endAt: string | null;
}

export interface SummaryDetails {
  target?: string | null;
  action?: string | null;
  host?: string | null;
  impact?: string | null;
}

// QUIRK(skkuverse-crawler): one entry per content change it detected, appended when the page's hash moves.
export interface NoticeEdit {
  detectedAt?: Date | string;
  oldHash?: string | null;
  newHash?: string | null;
  oldTitle?: string | null;
  newTitle?: string | null;
  titleChanged?: boolean;
  contentChanged?: boolean;
  source?: string | null;
}

export interface NoticeAttachment {
  name: string;
  url: string;
  referer?: string;
}

// CONTRACT(skkuverse-crawler): the crawler writes notices (skkuverse-crawler/docs/reference/schema/notices.md) and
// skkuverse-ai its summary fields. Hot reads are typed, not parsed (ADR 0010 D2, exemptions/repository-reads.json).
export interface NoticeDoc {
  _id: ObjectId;
  sourceId: string;
  articleNo: number;
  title: string;
  date: string;
  crawledAt: Date;
  sourceUrl: string;
  category?: string | null;
  author?: string | null;
  department?: string | null;
  views?: number;
  contentHash?: string | null;
  contentText?: string | null;
  cleanMarkdown?: string | null;
  attachments?: NoticeAttachment[];
  editCount?: number;
  editHistory?: NoticeEdit[];
  lastModified?: string | Date | null;
  summaryAt?: Date | string | null;
  summaryType?: string;
  summaryOneLiner?: string | null;
  summary?: string | null;
  summaryPeriods?: SummaryPeriod[];
  summaryLocations?: unknown[];
  summaryDetails?: SummaryDetails | null;
  summaryModel?: string | null;
  // WHY: the summary is stale when this differs from contentHash: the body changed after summarization.
  summaryContentHash?: string | null;
  summaryVersion?: number;
  summaryApplication?: SummaryApplication | null;
  summaryDates?: SummaryDate[];
  isDeleted?: boolean | null;
  // WHY: the dispatch gate, apart from summaryAt: the crawler sets it once the ai summary has landed.
  aiSummaryAt?: Date | null;
  // WHY: NoticesDispatchRepository is the only writer of the four push fields (dispatch/).
  pushedAt?: Date | null;
  pushAttempts?: number;
  dispatchClaimedAt?: Date | null;
  pushError?: string | null;
}
