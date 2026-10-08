import { Injectable, type OnModuleInit } from "@nestjs/common";
import logger from "../infra/logger";
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

  async onModuleInit(): Promise<void> {
    // 3-attempt retry with linear backoff, final failure logged at ERROR
    // (non-fatal). Without this index, list
    // queries fall back to full collection scan, which is expensive for the
    // 54MB+ notices collection.
    try {
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await ensureNoticeIndexes();
          logger.info({ event: "notices.indexes.ensured", attempt }, "Indexes ensured");
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
        }
      }
      if (lastErr) {
        logger.error(
          { event: "notices.indexes.failed", err: lastErr },
          "Index setup failed after 3 attempts — list queries will full-scan",
        );
      }
    } catch (err) {
      logger.error(
        { event: "notices.indexes.crashed", err },
        "Index setup crashed",
      );
    }
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
