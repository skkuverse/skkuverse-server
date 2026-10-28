import type { NoticeListRow } from "./notices-list.document";
import type { SummaryType } from "../notices.types";
import type { LIST_DAYS } from "./notices-list.constants";

export interface CursorPayload {
  d: string;
  // WHY: still emitted and accepted, never read: a cursor minted here stays decodable by the release before (ADR 0007).
  c?: string;
  i: string;
}

export type NoticeScope = string | readonly string[];

export type ListDay = (typeof LIST_DAYS)[number];

export interface ItemRowOptions {
  now: Date;
  /** WHY: set on a read of two or more sources only: a list of one board does not name it. */
  boardNameById: ReadonlyMap<string, string> | null;
}

export interface NoticeListQuery {
  limit: number;
  type?: SummaryType;
  cursor: CursorPayload | null;
  q?: string;
}

export interface ClusterLookup {
  keys: readonly string[];
  cursor: CursorPayload;
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
  items: NoticeListRow[];
  nextCursor: string | null;
  hasMore: boolean;
}
