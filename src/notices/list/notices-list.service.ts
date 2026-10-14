import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { toListItem, toNoticePage } from "./notices-list.mapper";
import { NoticesListRepository } from "./notices-list.repository";
import type { NoticeListQuery, NoticeScope } from "./notices-list.types";
import type { NoticeList } from "./notices-list.wire";

@Injectable()
export class NoticesListService {
  constructor(
    private readonly repository: NoticesListRepository,
    private readonly clock: Clock,
  ) {}

  async listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeList> {
    const page = toNoticePage(await this.repository.listNotices(scope, query), query.limit);
    const now = this.clock.now();
    return { notices: page.items.map((doc) => toListItem(doc, now)), nextCursor: page.nextCursor, hasMore: page.hasMore };
  }
}
