/**
 * The push payload the Cloud Function relays to devices (noticePushPayload, src/infra/fcm.wire.ts): built from
 * the group's representative and the union of topics, byte for byte; an empty category and a missing articleNo
 * are left out (umbrella issue 78).
 */
jest.mock("../../infra/fcm", () => ({ postToFcmFunction: jest.fn().mockResolvedValue({ sent: 3, failed: 0, cleanedUp: 0 }) }));

import { ObjectId } from "mongodb";
import { postToFcmFunction } from "../../infra/fcm";
import { noticePushPayload } from "../../infra/fcm.wire";
import type { NoticeDoc } from "../notices.document";
import { NoticesDispatchClient } from "./notices-dispatch.client";

const ID = new ObjectId("66a1b2c3d4e5f6a7b8c9d0e1");

function notice(extra: Partial<NoticeDoc> = {}): NoticeDoc {
  return {
    _id: ID,
    sourceId: "skku-notice02",
    articleNo: 140577,
    title: "제목",
    date: "2026-10-14",
    crawledAt: new Date("2026-10-14T00:00:00Z"),
    sourceUrl: "https://www.skku.edu/x",
    summaryOneLiner: "한 줄",
    category: "academic",
    ...extra,
  };
}

describe("NoticesDispatchClient.sendPush", () => {
  it("posts the notice payload with every field in its wire order and returns the function's counts", async () => {
    // Act
    const counts = await new NoticesDispatchClient().sendPush(notice(), ["category:academic"]);

    // Assert
    expect(counts).toEqual({ sent: 3, failed: 0, cleanedUp: 0 });
    const payload = (postToFcmFunction as jest.Mock).mock.calls[0][0];
    expect(JSON.stringify(payload)).toBe(
      '{"type":"notice","noticeId":"66a1b2c3d4e5f6a7b8c9d0e1","topics":["category:academic"],"title_ko":"제목","body_ko":"한 줄","title_en":null,"body_en":null,"sourceId":"skku-notice02","articleNo":"140577","category":"academic"}',
    );
    expect(noticePushPayload.safeParse(payload).success).toBe(true);
  });

  it("sends empty texts for a missing title or one-liner and leaves out an empty category", async () => {
    // Act
    await new NoticesDispatchClient().sendPush(notice({ title: "", summaryOneLiner: null, category: "" }), []);

    // Assert
    expect((postToFcmFunction as jest.Mock).mock.calls[1][0]).toEqual({
      type: "notice",
      noticeId: ID.toHexString(),
      topics: [],
      title_ko: "",
      body_ko: "",
      title_en: null,
      body_en: null,
      sourceId: "skku-notice02",
      articleNo: "140577",
    });
  });
});
