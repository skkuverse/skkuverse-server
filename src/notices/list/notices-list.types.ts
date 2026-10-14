import type { NoticeDoc } from "../notices.document";
import type { SummaryType } from "../notices.types";

export interface CursorPayload {
  d: string;
  // WHY: still emitted and accepted, never read: a cursor minted here stays decodable by the release before (ADR 0007).
  c?: string;
  i: string;
}

export type NoticeScope = string | readonly string[];

export interface NoticeListQuery {
  limit: number;
  type?: SummaryType;
  cursor: CursorPayload | null;
  q?: string;
}

export interface BriefDate {
  date: string | null;
  time: string | null;
}

export interface BriefEnd extends BriefDate {
  label: string | null;
}

export interface BriefDates {
  type: SummaryType;
  startAt: BriefDate | null;
  endAt: BriefEnd | null;
}

export interface NoticePage {
  items: NoticeDoc[];
  nextCursor: string | null;
  hasMore: boolean;
}
