import { Injectable } from "@nestjs/common";
import { buildTopics, TOPIC_CAP } from "./topics.bridge";

/**
 * (An operations detail is left out of the public history.)
 *
 */
@Injectable()
export class TopicsService {
  /** Max topics per notice (10; sendNotification rejects more). */
  readonly TOPIC_CAP = TOPIC_CAP;

  /** Map a notice document → its FCM topic strings (≤ TOPIC_CAP). */
  buildTopics(noticeDoc: { sourceId?: string } | null | undefined): string[] {
    return buildTopics(noticeDoc);
  }
}
