/**
 * The push payload the Cloud Function relays to devices (noticePushPayload, src/infra/fcm.wire.ts): built from
 * the group's representative and the union of topics, byte for byte; an empty category and a missing articleNo
 * are left out (umbrella issue 78).
 */
jest.mock("../../infra/fcm", () => ({ postToFcmFunction: jest.fn().mockResolvedValue({ sent: 3, failed: 0, cleanedUp: 0 }) }));

jest.mock("../../infra/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

import { ObjectId } from "mongodb";
import { goldenRecord } from "../../../__tests__/helpers/notices/facts-records";
import type { Clock } from "../../infra/clock";
import { postToFcmFunction } from "../../infra/fcm";
import { noticePushPayload } from "../../infra/fcm.wire";
import { NoticesFactsService } from "../facts/notices-facts.service";
import { NoticesLegacyService } from "../legacy/notices-legacy.service";
import type { NoticeDoc } from "../notices.document";
import { NoticesRowService } from "../row/notices-row.service";
import { NoticesDispatchClient } from "./notices-dispatch.client";

const clock: Clock = { now: () => new Date("2026-10-22T03:00:00Z") };
const dispatchClient = (): NoticesDispatchClient => new NoticesDispatchClient(new NoticesLegacyService(new NoticesRowService(new NoticesFactsService(clock))), clock);

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
    const counts = await dispatchClient().sendPush(notice(), ["category:academic"]);

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
    await dispatchClient().sendPush(notice({ title: "", summaryOneLiner: null, category: "" }), []);

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

describe("NoticesDispatchClient.sendPush body", () => {
  const facts = { facts: goldenRecord("a_deadline_tomorrow_reads_as_one_while_the_window_is_open"), summaryOneLiner: null };

  const bodyOf = async (extra: Partial<NoticeDoc>): Promise<string> => {
    await dispatchClient().sendPush(notice({ ...facts, ...extra }), []);
    return ((postToFcmFunction as jest.Mock).mock.lastCall?.[0] as { body_ko: string }).body_ko;
  };

  it("reads the derived one-liner when the notice has none of its own and its facts landed in time", async () => {
    // Act & Assert
    expect(await bodyOf({ factsGate: "ok" })).toBe("10/26(월) 마감");
  });

  it.each(["failed", "timeout", null] as const)("sends a title-only push when the facts gate is %s and there is no summary", async (factsGate) => {
    // Act & Assert
    expect(await bodyOf({ factsGate })).toBe("");
  });

  it("sends a title-only push when the facts gate passed but the record is refused by the schema", async () => {
    // Act & Assert
    expect(await bodyOf({ factsGate: "ok", facts: { ...facts.facts, v: 2 } })).toBe("");
  });

  it("keeps the stored one-liner over the derived one", async () => {
    // Act & Assert
    expect(await bodyOf({ factsGate: "ok", summaryOneLiner: "한 줄" })).toBe("한 줄");
  });
});
