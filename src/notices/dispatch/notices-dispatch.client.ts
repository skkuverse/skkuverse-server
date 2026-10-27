import { Injectable } from "@nestjs/common";
import { postToFcmFunction, type FcmResponse } from "../../infra/fcm";
import type { NoticePushPayload } from "../../infra/fcm.wire";
import type { NoticeDoc } from "../notices.document";

@Injectable()
export class NoticesDispatchClient {
  sendPush(notice: NoticeDoc, topics: string[]): Promise<FcmResponse> {
    return postToFcmFunction(this.toPushPayload(notice, topics));
  }

  // WHY: the Cloud Function relays these fields to the device, as its notice request shape names them;
  // an empty category is left out, which it reads as the general channel (umbrella issue 78).
  private toPushPayload(notice: NoticeDoc, topics: string[]): NoticePushPayload {
    return {
      type: "notice",
      noticeId: String(notice._id),
      topics,
      title_ko: notice.title || "",
      body_ko: notice.summaryOneLiner || "",
      title_en: null,
      body_en: null,
      ...(notice.sourceId ? { sourceId: notice.sourceId } : {}),
      ...(notice.articleNo != null ? { articleNo: String(notice.articleNo) } : {}),
      ...(notice.category ? { category: notice.category } : {}),
    };
  }
}
