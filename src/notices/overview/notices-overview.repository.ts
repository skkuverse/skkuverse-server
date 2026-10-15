import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { NoticeDoc } from "../notices.document";
import { RETRIEVAL_MAX_TIME_MS } from "./notices-overview.constants";
import { toOverviewPipeline } from "./notices-overview.query";
import type { OverviewCandidate } from "./notices-overview.types";

@Injectable()
export class NoticesOverviewRepository {
  searchCandidates(searchText: string, sourceIds: readonly string[]): Promise<OverviewCandidate[]> {
    const pipeline = toOverviewPipeline({ q: searchText, sourceIds, serviceStartDate: config.notices.serviceStartDate });
    return this.notices().aggregate<OverviewCandidate>(pipeline, { maxTimeMS: RETRIEVAL_MAX_TIME_MS }).toArray();
  }

  private notices(): Collection<NoticeDoc> {
    return mongoCollection<NoticeDoc>(config.notices.dbName, config.notices.collections.notices);
  }
}
