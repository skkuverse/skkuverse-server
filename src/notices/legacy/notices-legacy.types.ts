import type { SummaryType } from "../notices.types";

export interface DerivedBriefDate {
  date: string | null;
  time: string | null;
}

export interface DerivedBriefEnd extends DerivedBriefDate {
  label: string | null;
}

export interface DerivedBrief {
  oneLiner: string | null;
  type: SummaryType;
  startAt: DerivedBriefDate | null;
  endAt: DerivedBriefEnd | null;
}
