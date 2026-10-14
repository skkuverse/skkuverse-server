import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { mongoCollection } from "../../infra/mongo";
import type { NoticeDoc } from "../notices.document";
import { DETAIL_PROJECTION } from "./notices-detail.query";

@Injectable()
export class NoticesDetailRepository {
  // QUIRK(skkuverse-crawler): served by the crawler's unique articleNo_1_sourceId_1 index; a soft-deleted notice is a miss.
  findNotice(sourceId: string, articleNo: number): Promise<NoticeDoc | null> {
    return this.notices().findOne(
      { sourceId, articleNo, isDeleted: { $ne: true } },
      { projection: DETAIL_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS },
    );
  }

  private notices(): Collection<NoticeDoc> {
    return mongoCollection<NoticeDoc>(config.notices.dbName, config.notices.collections.notices);
  }
}
