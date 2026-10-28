import { Injectable } from "@nestjs/common";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { toFactsRows } from "./notices-row.rules";
import type { RenderedNotice, RowNotice, RowSource } from "./notices-row.types";

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

  private toRowSource(notice: RowNotice): RowSource | null {
    const facts = this.facts.parseFacts(notice.facts, notice._id);
    return facts && { facts, factsHistory: notice.factsHistory ?? [], title: notice.title };
  }
}
