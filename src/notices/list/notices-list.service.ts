import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import { noticesConfig } from "../notices.config";
import { NoticesRowService } from "../row/notices-row.service";
import { toItemRow, toListItem, toNoticePage, withDerivedBrief } from "./notices-list.mapper";
import { NoticesListRepository } from "./notices-list.repository";
import type { NoticeListQuery, NoticeScope } from "./notices-list.types";
import type { NoticeList } from "./notices-list.wire";

@Injectable()
export class NoticesListService {
  private readonly boardNameById = new Map(noticesConfig.sources.map((source) => [source.id, source.name]));

  constructor(
    private readonly repository: NoticesListRepository,
    private readonly clock: Clock,
    private readonly rows: NoticesRowService,
    private readonly legacy: NoticesLegacyService,
  ) {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeList> {
    const page = toNoticePage(await this.repository.listNotices(scope, query), query.limit);
    const now = this.clock.now();
    const options = { now, boardNameById: typeof scope === "string" || new Set(scope).size < 2 ? null : this.boardNameById };
    const notices = this.rows
      .renderRows(page.items, now)
      .map(({ notice, row }) => ({ notice, row, derived: this.legacy.deriveBrief(notice, now) }))
      .filter(({ notice, derived }) => !query.type || notice.summaryAt || derived?.type === query.type)
      .map(({ notice, row, derived }) => withDerivedBrief(toListItem(notice, now, row && toItemRow(row, notice, options)), derived));
    return { notices, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }
}
