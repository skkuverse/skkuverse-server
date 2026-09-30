/**
 * MiniAppNotificationsService — the feed write and the delivery are ONE
 * operation, and the interesting cases are the ones where that pairing is under
 * stress.
 *
 * skkuverse-app ADR 0002's Revisited section permits this feed only because it
 * is broadcast-only, and its added consequence is that the two writes have to
 * agree. So the load-bearing test here is not "a send works" — it is that a
 * FAILED delivery still leaves the feed entry, with `delivery: null` recording
 * what actually happened. Deleting it there would be the same drift in the other
 * direction: devices that did receive the push, with nothing to recover from.
 */

const insertSentNotification = jest.fn();
const recordDelivery = jest.fn();
const listSentNotifications = jest.fn();
const ensureIndexes = jest.fn();
const postToFcmFunction = jest.fn();

jest.mock("../../../src/miniapps/miniapps.data", () => ({
  ensureIndexes: (...a: unknown[]) => ensureIndexes(...a),
  insertSentNotification: (...a: unknown[]) => insertSentNotification(...a),
  recordDelivery: (...a: unknown[]) => recordDelivery(...a),
  listSentNotifications: (...a: unknown[]) => listSentNotifications(...a),
}));

jest.mock("../../../src/common/fcm-client", () => ({
  postToFcmFunction: (...a: unknown[]) => postToFcmFunction(...a),
}));

jest.mock("../../../src/infra/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

import {
  FEED_CACHE_TTL_MS,
  MiniAppNotificationsService,
} from "../../../src/miniapps/miniapps-notifications.service";

// Fresh per test: the feed is cached per instance, so a shared instance would
// carry one test's rows into the next.
let service: MiniAppNotificationsService;
const validDraft = { title_ko: "우천 안내", body_ko: "공연이 30분 지연됩니다." };

beforeEach(() => {
  jest.clearAllMocks();
  service = new MiniAppNotificationsService();
  insertSentNotification.mockResolvedValue(undefined);
  recordDelivery.mockResolvedValue(undefined);
  postToFcmFunction.mockResolvedValue({ sent: 12, failed: 1, cleanedUp: 1 });
});

describe("send — the feed entry and the delivery", () => {
  it("writes the feed entry BEFORE calling the function, so the id it passes exists", async () => {
    const result = await service.send("eskara-2026", validDraft);

    expect(insertSentNotification).toHaveBeenCalledTimes(1);
    const written = insertSentNotification.mock.calls[0][0];
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.notificationId).toBe(written._id);
    expect("notificationId" in result ? result.notificationId : null).toBe(written._id);
  });

  it("forces nothing about topics — the function receives miniAppId, never a topics array", async () => {
    await service.send("eskara-2026", validDraft);
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.miniAppId).toBe("eskara-2026");
    expect(payload.type).toBe("miniapp");
    expect(payload).not.toHaveProperty("topics");
  });

  it("records what the function reported", async () => {
    const result = await service.send("eskara-2026", validDraft);
    expect(recordDelivery).toHaveBeenCalledWith(expect.any(String), {
      sent: 12,
      failed: 1,
      cleanedUp: 1,
    });
    expect("delivery" in result ? result.delivery : null).toEqual({
      sent: 12,
      failed: 1,
      cleanedUp: 1,
    });
  });

  it("KEEPS the feed entry when delivery fails, with delivery: null", async () => {
    postToFcmFunction.mockRejectedValue(new Error("sendNotification 500: boom"));

    const result = await service.send("eskara-2026", validDraft);

    expect(insertSentNotification).toHaveBeenCalledTimes(1);
    expect("delivery" in result ? result.delivery : undefined).toBeNull();
    expect("error" in result ? result.error : "").toContain("boom");
    // The entry stays. Nothing deletes it, and no delivery is recorded over it.
    expect(recordDelivery).not.toHaveBeenCalled();
  });

  it("reports DELIVERED when the multicast succeeded but recording it failed", async () => {
    // 4200 devices already have the banner. Calling this "delivery failed" is
    // the lie that gets ops to resend, and everyone gets it twice.
    postToFcmFunction.mockResolvedValue({ sent: 4200, failed: 3, cleanedUp: 0 });
    recordDelivery.mockRejectedValue(new Error("replica set step-down"));

    const result = await service.send("eskara-2026", validDraft);

    expect("delivery" in result ? result.delivery : null).toEqual({
      sent: 4200,
      failed: 3,
      cleanedUp: 0,
    });
    expect("error" in result ? result.error : undefined).toBeUndefined();
  });

  it("stores the Korean text and a null English pair when none is given", async () => {
    await service.send("eskara-2026", validDraft);
    const written = insertSentNotification.mock.calls[0][0];
    expect(written.title_ko).toBe("우천 안내");
    expect(written.title_en).toBeNull();
    expect(written.body_en).toBeNull();
    expect(written.delivery).toBeNull();
  });
});

describe("send — validation happens before anything is written", () => {
  it.each([
    ["missing title_ko", { body_ko: "b" }],
    ["missing body_ko", { title_ko: "t" }],
    ["blank title_ko", { title_ko: "   ", body_ko: "b" }],
  ])("rejects %s", async (_label, draft) => {
    const result = await service.send("eskara-2026", draft);
    expect("problems" in result).toBe(true);
    expect(insertSentNotification).not.toHaveBeenCalled();
    expect(postToFcmFunction).not.toHaveBeenCalled();
  });

  it("rejects an actionType the app cannot navigate, rather than recording a dead destination", async () => {
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType: "content",
      actionValue: "some prose",
    });
    expect("problems" in result).toBe(true);
    expect(insertSentNotification).not.toHaveBeenCalled();
  });

  it.each([
    ["the bare mini app", "eskara-2026"],
    ["one of its pages", "eskara-2026/eskara/wristband"],
  ])("accepts a miniapp target naming %s and forwards it verbatim", async (_l, actionValue) => {
    await service.send("eskara-2026", { ...validDraft, actionType: "miniapp", actionValue });
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.actionType).toBe("miniapp");
    expect(payload.actionValue).toBe(actionValue);
  });

  it.each([
    ["another mini app", "hssc/notice"],
    ["a URL rather than a target", "https://eskara.miniapp.skkuverse.com/eskara"],
    ["a path that escapes the origin", "eskara-2026//evil.com"],
  ])("rejects a miniapp value naming %s", async (_l, actionValue) => {
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType: "miniapp",
      actionValue,
    });
    expect("problems" in result).toBe(true);
    expect(insertSentNotification).not.toHaveBeenCalled();
  });

  it.each([
    ["webview with a non-https value", "webview", "itms-apps://apps.apple.com/app/id1"],
    ["external with plain http", "external", "http://x.test"],
    ["route that is not a path", "route", "https://x.test/a"],
  ])("rejects %s — mirroring the device-side check", async (_l, actionType, actionValue) => {
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType,
      actionValue,
    });
    expect("problems" in result).toBe(true);
  });

  it("accepts a well-formed webview target and forwards it verbatim", async () => {
    await service.send("eskara-2026", {
      ...validDraft,
      actionType: "webview",
      actionValue: "https://webview.skkuverse.com/eskara/shuttle",
    });
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.actionType).toBe("webview");
    expect(payload.actionValue).toBe("https://webview.skkuverse.com/eskara/shuttle");
  });

  it("rejects actionType without actionValue", async () => {
    const result = await service.send("eskara-2026", {
      ...validDraft,
      actionType: "webview",
    });
    expect("problems" in result).toBe(true);
  });
});

describe("feed", () => {
  const doc = {
    _id: "n1",
    miniAppId: "eskara-2026",
    title_ko: "한국어",
    body_ko: "본문",
    title_en: "English",
    body_en: "Body",
    sentAt: new Date("2026-09-01T03:00:00.000Z"),
    delivery: { sent: 1, failed: 0, cleanedUp: 0 },
  };

  it("returns Korean by default", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "ko");
    expect(entry.title).toBe("한국어");
    expect(entry.id).toBe("n1");
    expect(entry.sentAt).toBe("2026-09-01T03:00:00.000Z");
  });

  it("returns English when asked", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "en");
    expect(entry.title).toBe("English");
  });

  it("falls back to Korean when the English pair is absent", async () => {
    listSentNotifications.mockResolvedValue([{ ...doc, title_en: null, body_en: null }]);
    const [entry] = await service.feed("eskara-2026", "en");
    expect(entry.title).toBe("한국어");
  });

  it("falls back to Korean for zh — the payload carries ko/en only", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "zh");
    expect(entry.title).toBe("한국어");
  });

  it("never leaks the delivery record to the public feed", async () => {
    listSentNotifications.mockResolvedValue([doc]);
    const [entry] = await service.feed("eskara-2026", "ko");
    expect(entry).not.toHaveProperty("delivery");
    expect(entry).not.toHaveProperty("title_ko");
  });
});

describe("feed cache — reads every client makes must not scale Mongo ops", () => {
  const doc = {
    _id: "n1",
    miniAppId: "eskara-2026",
    title_ko: "한국어",
    body_ko: "본문",
    title_en: "English",
    body_en: "Body",
    sentAt: new Date("2026-09-01T03:00:00.000Z"),
    delivery: { sent: 1, failed: 0, cleanedUp: 0 },
  };
  let clock = 1_000_000;

  beforeEach(() => {
    clock = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    listSentNotifications.mockResolvedValue([doc]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves repeated reads from one query while fresh", async () => {
    await Promise.all([
      service.feed("eskara-2026", "ko"),
      service.feed("eskara-2026", "ko"),
      service.feed("eskara-2026", "ko"),
    ]);
    await service.feed("eskara-2026", "ko");
    expect(listSentNotifications).toHaveBeenCalledTimes(1);
  });

  it("shares one query across languages — the language is applied after the read", async () => {
    const ko = await service.feed("eskara-2026", "ko");
    const en = await service.feed("eskara-2026", "en");
    expect(listSentNotifications).toHaveBeenCalledTimes(1);
    expect(ko[0].title).toBe("한국어");
    expect(en[0].title).toBe("English");
  });

  it("reloads once the TTL has passed", async () => {
    await service.feed("eskara-2026", "ko");
    clock += FEED_CACHE_TTL_MS + 1;
    await service.feed("eskara-2026", "ko");
    // Inside the stale window the expired value is served while a reload runs.
    await Promise.resolve();
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });

  it("keeps separate caches per mini app", async () => {
    await service.feed("eskara-2026", "ko");
    await service.feed("hssc", "ko");
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
    expect(listSentNotifications.mock.calls.map((c) => c[0])).toEqual(["eskara-2026", "hssc"]);
  });

  it("drops this mini app's cache on send, so the sender's replica shows it at once", async () => {
    await service.feed("eskara-2026", "ko");
    await service.send("eskara-2026", validDraft);
    await service.feed("eskara-2026", "ko");
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed read", async () => {
    listSentNotifications.mockRejectedValueOnce(new Error("atlas down"));
    await expect(service.feed("eskara-2026", "ko")).rejects.toThrow("atlas down");
    const [entry] = await service.feed("eskara-2026", "ko");
    expect(entry.id).toBe("n1");
    expect(listSentNotifications).toHaveBeenCalledTimes(2);
  });
});

describe("history — the operator's view, delivery included", () => {
  it("returns the delivery record the public feed hides, uncached", async () => {
    const doc = {
      _id: "n1",
      miniAppId: "eskara-2026",
      title_ko: "우천 안내",
      body_ko: "지연",
      title_en: null,
      body_en: null,
      actionType: "route",
      actionValue: "/miniapp-feed/eskara-2026",
      sentAt: new Date("2026-10-01T09:00:00.000Z"),
      delivery: { sent: 812, failed: 3, cleanedUp: 2 },
    };
    listSentNotifications.mockResolvedValue([doc]);

    const first = await service.history("eskara-2026");
    await service.history("eskara-2026");

    expect(listSentNotifications).toHaveBeenCalledTimes(2);
    expect(first).toEqual([
      {
        id: "n1",
        title_ko: "우천 안내",
        body_ko: "지연",
        actionType: "route",
        actionValue: "/miniapp-feed/eskara-2026",
        sentAt: "2026-10-01T09:00:00.000Z",
        delivery: { sent: 812, failed: 3, cleanedUp: 2 },
      },
    ]);
  });

  it("reports an undelivered entry as delivery: null", async () => {
    listSentNotifications.mockResolvedValue([
      {
        _id: "n2",
        miniAppId: "eskara-2026",
        title_ko: "t",
        body_ko: "b",
        title_en: null,
        body_en: null,
        sentAt: new Date("2026-10-01T09:00:00.000Z"),
        delivery: null,
      },
    ]);
    const [entry] = await service.history("eskara-2026");
    expect(entry.delivery).toBeNull();
  });
});
