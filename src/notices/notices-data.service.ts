import { Injectable, type OnModuleInit } from "@nestjs/common";
import { ensureIndexesAtBoot } from "../infra/mongo";
import {
  DETAIL_PROJECTION,
  LIST_PROJECTION,
  ensureNoticeIndexes,
  findNoticeByArticleNo,
  findNoticesBySource,
  findNoticesBySources,
  getNoticesCollection,
} from "./notices.data";
import type { CursorPayload, NoticeDoc } from "./types";

interface FindOpts {
  cursor?: CursorPayload | null;
  limit: number;
  type?: string;
  q?: string | null;
}

interface FindResult {
  items: NoticeDoc[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * NoticesDataService — thin @Injectable wrapper over the validated, read-only
 * notices.data module (raw mongodb driver via src/infra/db.ts, NOT
 * Mongoose). Every method delegates 1:1 — no reimplementation, no defensive
 * narrowing — so the LIST/DETAIL projections, the FORCE_INDEX .hint(), the
 * serviceStartDate floor, the cursor encoding, and the isDeleted $ne true
 * filter live only in notices.data.
 *
 * onModuleInit retries ensureNoticeIndexes() up to 3 times with 1000*attempt
 * backoff; on final failure it logs at ERROR level (NON-FATAL — "list queries
 * will full-scan") rather than crashing. No silent narrowing: the
 * retry/error-log contract is not degraded into a swallow.
 *
 * getNoticesCollection / LIST_PROJECTION / DETAIL_PROJECTION are re-exposed so
 * the dispatcher + controllers reuse the same raw-driver handles.
 */
@Injectable()
export class NoticesDataService implements OnModuleInit {
  readonly LIST_PROJECTION = LIST_PROJECTION;
  readonly DETAIL_PROJECTION = DETAIL_PROJECTION;

  onModuleInit(): Promise<void> {
    return ensureIndexesAtBoot("notices", ensureNoticeIndexes, { attempts: 3, backoffMs: 1_000, failLevel: "error" });
  }

  getNoticesCollection(): ReturnType<typeof getNoticesCollection> {
    return getNoticesCollection();
  }

  findNoticesBySource(sourceId: string, opts: FindOpts): Promise<FindResult> {
    return findNoticesBySource(sourceId, opts);
  }

  findNoticesBySources(
    sourceIds: string[],
    opts: FindOpts,
  ): Promise<FindResult> {
    return findNoticesBySources(sourceIds, opts);
  }

  findNoticeByArticleNo(
    sourceId: string,
    articleNo: unknown,
  ): Promise<NoticeDoc | null> {
    return findNoticeByArticleNo(sourceId, articleNo);
  }
}
