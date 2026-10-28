import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { noticesConfig } from "../notices.config";
import { NoticesRowService } from "../row/notices-row.service";
import { toItemRow, toListItem, toNoticePage } from "./notices-list.mapper";
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
  ) {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeList> {
    const page = toNoticePage(await this.repository.listNotices(scope, query), query.limit);
    const now = this.clock.now();
    const options = { now, boardNameById: typeof scope === "string" ? null : this.boardNameById };
    const notices = this.rows.renderRows(page.items, now).map(({ notice, row }) => toListItem(notice, now, row && toItemRow(row, notice, options)));
    return { notices, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }
}
