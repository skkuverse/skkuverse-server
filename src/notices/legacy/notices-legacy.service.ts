import { Injectable } from "@nestjs/common";
import type { NoticeDoc } from "../notices.document";
import { NoticesRowService } from "../row/notices-row.service";
import type { RowNotice } from "../row/notices-row.types";
import { toDerivedBrief } from "./notices-legacy.rules";
import type { DerivedBrief } from "./notices-legacy.types";

@Injectable()
export class NoticesLegacyService {
  constructor(private readonly rows: NoticesRowService) {}

  // WHY: null while the notice has its own summary, so a stored summary is served untouched.
  deriveBrief(notice: RowNotice & Pick<NoticeDoc, "summaryAt">, now: Date): DerivedBrief | null {
    if (notice.summaryAt) return null;
    const reading = this.rows.readNotice(notice, now);
    return reading && toDerivedBrief(reading);
  }
}
