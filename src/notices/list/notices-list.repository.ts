import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { ensureIndexesAtBoot, mongoCollection } from "../../infra/mongo";
import type { NoticeDoc } from "../notices.document";
import type { NoticeListRow } from "./notices-list.document";
import { FORCE_INDEX, LIST_PROJECTION, LIST_SORT, toNoticeListFilter } from "./notices-list.query";
import type { NoticeListQuery, NoticeScope } from "./notices-list.types";

@Injectable()
export class NoticesListRepository implements OnModuleInit {
  // WHY: three attempts and an error-level failure: without this index every list read fails its hint (issue 73).
  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("notices", () => this.ensureIndexes(), { attempts: 3, backoffMs: 1_000, failLevel: "error" });
  }

  listNotices(scope: NoticeScope, query: NoticeListQuery): Promise<NoticeListRow[]> {
    return this.notices()
      .find<NoticeListRow>(toNoticeListFilter(scope, query, config.notices.serviceStartDate), {
        projection: LIST_PROJECTION,
        maxTimeMS: HOT_READ_MAX_TIME_MS,
      })
      .sort(LIST_SORT)
      .hint(FORCE_INDEX)
      .limit(query.limit + 1)
      .toArray();
  }

  // QUIRK(skkuverse-crawler): the crawler owns the unique articleNo_1_sourceId_1 index; this read index is ours.
  private async ensureIndexes(): Promise<void> {
    await this.notices().createIndex(FORCE_INDEX);
  }

  private notices(): Collection<NoticeDoc> {
    return mongoCollection<NoticeDoc>(config.notices.dbName, config.notices.collections.notices);
  }
}
