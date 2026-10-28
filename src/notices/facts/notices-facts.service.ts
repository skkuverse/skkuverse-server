import { Injectable } from "@nestjs/common";
import type { ObjectId } from "mongodb";
import { Clock } from "../../infra/clock";
import logger from "../../infra/logger";
import { createLogThrottle } from "../../shared/log-throttle.util";
import { issuePaths, parseEach } from "../../shared/zod-list.util";
import type { FactsSnapshot } from "../notices.document";
import { NOTICES_FACTS_LOG_INTERVAL_MS } from "./notices-facts.constants";
import { factsSnapshot, noticeFacts, type NoticeFacts } from "./notices-facts.schema";

@Injectable()
export class NoticesFactsService {
  private readonly unparsedThrottle = createLogThrottle(NOTICES_FACTS_LOG_INTERVAL_MS, () => this.clock.now().getTime());
  private readonly historyThrottle = createLogThrottle(NOTICES_FACTS_LOG_INTERVAL_MS, () => this.clock.now().getTime());

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

  parseFactsHistory(stored: unknown, noticeId: ObjectId): FactsSnapshot[] {
    if (stored === undefined || stored === null) return [];
    if (!Array.isArray(stored)) {
      this.logDroppedSnapshots(noticeId, ["(root): not a list"]);
      return [];
    }
    const { valid, invalid } = parseEach(stored, factsSnapshot, (_snapshot, position) => String(position));
    if (invalid.length > 0) this.logDroppedSnapshots(noticeId, invalid);
    return valid;
  }

  private logDroppedSnapshots(noticeId: ObjectId, dropped: readonly string[]): void {
    const ticket = this.historyThrottle.take(noticeId.toHexString());
    if (!ticket) return;
    logger.warn(
      { event: "notices.facts.history_unparsed", noticeId: noticeId.toHexString(), dropped, ...ticket },
      "Notice facts history entries left out: they do not match the snapshot schema",
    );
  }

  private storedVersion(stored: unknown): number | string | undefined {
    const version = typeof stored === "object" ? (stored as { v?: unknown }).v : undefined;
    return typeof version === "number" || typeof version === "string" ? version : undefined;
  }
}
