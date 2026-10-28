import { Injectable } from "@nestjs/common";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { toFactsRows, toRowReading } from "./notices-row.rules";
import type { RenderedNotice, RowNotice, RowReading, RowSource } from "./notices-row.types";

@Injectable()
export class NoticesRowService {
  constructor(private readonly facts: NoticesFactsService) {}

  renderRows<T extends RowNotice>(notices: readonly T[], now: Date): Array<RenderedNotice<T>> {
    const rows = toFactsRows(
      notices.map((notice) => this.toRowSource(notice)),
      now,
    );
    return notices.map((notice, i) => ({ notice, row: rows[i] ?? null }));
  }

  readNotice(notice: RowNotice, now: Date): RowReading | null {
    const source = this.toRowSource(notice);
    return source && toRowReading(source, now);
  }

  private toRowSource(notice: RowNotice): RowSource | null {
    const facts = this.facts.parseFacts(notice.facts, notice._id);
    return facts && { facts, factsHistory: this.facts.parseFactsHistory(notice.factsHistory, notice._id), title: notice.title };
  }
}
