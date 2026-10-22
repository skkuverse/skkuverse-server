/**
 * The notification shapes. What it guards: the stored row byte for byte (key
 * order included), the log trace, the feed's language with its Korean
 * fallback, and the history's nulls for rows that lack a field.
 */
import type { SentNotificationDoc } from "../miniapps.document";
import { toFeedEntry, toHistoryEntry, toReplayedOutcome, toSendTrace, toSentNotification } from "./miniapps-notifications.mapper";

const SENT_AT = new Date("2026-10-14T03:00:00.000Z");

const DOC: SentNotificationDoc = {
  _id: "n1",
  miniAppId: "eskara-2026",
  title_ko: "제목",
  body_ko: "본문",
  title_en: "Title",
  body_en: null,
  actionType: "route",
  actionValue: "/campus",
  sentAt: SENT_AT,
  delivery: null,
};

describe("toSentNotification", () => {
  it("writes the row in the stored key order, with delivery null", () => {
    // Arrange
    const content = { title_ko: "제목", body_ko: "본문", title_en: "Title", body_en: null, actionType: "route", actionValue: "/campus" } as const;

    // Act
    const doc = toSentNotification(content, { id: "n1", miniAppId: "eskara-2026", sentAt: SENT_AT });

    // Assert
    expect(JSON.stringify(doc)).toBe(JSON.stringify(DOC));
  });
});

describe("toSentNotification with an Idempotency-Key", () => {
  it("writes the key last, after the row's other fields", () => {
    // Arrange
    const content = { title_ko: "제목", body_ko: "본문", title_en: "Title", body_en: null, actionType: "route", actionValue: "/campus" } as const;

    // Act
    const doc = toSentNotification(content, { id: "n1", miniAppId: "eskara-2026", sentAt: SENT_AT, idempotencyKey: "retry-1" });

    // Assert
    expect(JSON.stringify(doc)).toBe(JSON.stringify({ ...DOC, idempotencyKey: "retry-1" }));
  });
});

describe("toReplayedOutcome", () => {
  it("answers a delivered row with its counts", () => {
    // Act & Assert
    expect(toReplayedOutcome({ ...DOC, delivery: { sent: 5, failed: 1, cleanedUp: 0 } })).toEqual({
      notificationId: "n1",
      delivery: { sent: 5, failed: 1, cleanedUp: 0 },
      outcome: "delivered",
    });
  });

  it.each(["not_sent", "unknown"] as const)("answers a failed row with its stored %s outcome and error", (outcome) => {
    // Act & Assert
    expect(toReplayedOutcome({ ...DOC, deliveryError: { outcome, error: "boom" } })).toEqual({
      notificationId: "n1",
      delivery: null,
      outcome,
      error: "boom",
    });
  });

  it("answers unknown for a row with neither delivery nor deliveryError", () => {
    // Act & Assert
    expect(toReplayedOutcome(DOC)).toEqual({
      notificationId: "n1",
      delivery: null,
      outcome: "unknown",
      error: "the first send with this Idempotency-Key has no recorded outcome yet; check the Cloud Function log for this notificationId",
    });
  });
});

describe("toSendTrace", () => {
  it("cuts the title to the log's length and says whether English was sent", () => {
    // Act & Assert
    expect(toSendTrace({ ...DOC, title_ko: "가".repeat(100) })).toEqual({
      miniAppId: "eskara-2026",
      notificationId: "n1",
      title: "가".repeat(80),
      actionType: "route",
      actionValue: "/campus",
      hasEn: true,
    });
  });
});

describe("toFeedEntry", () => {
  it.each([
    ["ko", "제목", "본문"],
    ["en", "Title", "본문"],
    ["zh", "제목", "본문"],
  ] as const)("serves %s as its own text, Korean where it has none", (lang, title, body) => {
    // Act & Assert
    expect(toFeedEntry(DOC, lang)).toEqual({ id: "n1", title, body, sentAt: "2026-10-14T03:00:00.000Z", actionType: "route", actionValue: "/campus" });
  });
});

describe("toHistoryEntry", () => {
  it("serves null for a field the row lacks", () => {
    // Arrange
    const legacy = { _id: "n4", miniAppId: "a", title_ko: "t", body_ko: "b", sentAt: SENT_AT } as unknown as SentNotificationDoc;

    // Act & Assert
    expect(toHistoryEntry(legacy)).toEqual({
      id: "n4",
      title_ko: "t",
      body_ko: "b",
      title_en: null,
      body_en: null,
      sentAt: "2026-10-14T03:00:00.000Z",
      delivery: null,
      deliveryError: null,
    });
  });
});
