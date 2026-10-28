import { Injectable } from "@nestjs/common";
import type { ObjectId } from "mongodb";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { createLogThrottle } from "../../shared/log-throttle.util";
import { issuePaths } from "../../shared/zod-list.util";
import { NOTICES_FACTS_LOG_INTERVAL_MS } from "./notices-facts.constants";
import { noticeFacts, type NoticeFacts } from "./notices-facts.schema";

@Injectable()
export class NoticesFactsService {
  private readonly unparsedThrottle = createLogThrottle(NOTICES_FACTS_LOG_INTERVAL_MS, () => this.clock.now().getTime());

  constructor(private readonly clock: Clock) {}

  parseFacts(stored: unknown, noticeId: ObjectId): NoticeFacts | null {
    if (stored === undefined || stored === null) return null;
    const parsed = noticeFacts.safeParse(stored);
    if (parsed.success) return parsed.data;
    const ticket = this.unparsedThrottle.take(noticeId.toHexString());
    if (ticket) {
      logger.warn(
        { event: "notices.facts.unparsed", noticeId: noticeId.toHexString(), factsVersion: this.storedVersion(stored), paths: issuePaths(parsed.error), ...ticket },
        "Notice facts left out: they do not match the record schema",
      );
    }
    return null;
  }

  private storedVersion(stored: unknown): number | string | undefined {
    const version = typeof stored === "object" ? (stored as { v?: unknown }).v : undefined;
    return typeof version === "number" || typeof version === "string" ? version : undefined;
  }
}
