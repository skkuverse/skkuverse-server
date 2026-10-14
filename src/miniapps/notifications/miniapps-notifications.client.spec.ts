/**
 * MiniappsNotificationsClient over the FCM seam: the push payload it builds from
 * a stored row, byte for byte (the Cloud Function relays it to every device),
 * its counts back as numbers (a missing one as 0, as the history needs three),
 * and a failed call rejecting with the error the service classifies.
 */
const postToFcmFunction = jest.fn();
jest.mock("../../infra/fcm", () => ({ postToFcmFunction: (...args: unknown[]) => postToFcmFunction(...args) }));

import type { SentNotificationDoc } from "../miniapps.document";
import { MiniappsNotificationsClient } from "./miniapps-notifications.client";

const ROW: SentNotificationDoc = {
  _id: "n1",
  miniAppId: "eskara-2026",
  title_ko: "제목",
  body_ko: "본문",
  title_en: null,
  body_en: null,
  sentAt: new Date("2026-10-14T03:00:00.000Z"),
  delivery: null,
};

beforeEach(() => {
  postToFcmFunction.mockReset();
});

describe("MiniappsNotificationsClient.sendPush", () => {
  it("sends the row's fields in the order the Cloud Function has always received them", async () => {
    // Arrange
    postToFcmFunction.mockResolvedValue({ sent: 1 });

    // Act
    await new MiniappsNotificationsClient().sendPush({ ...ROW, actionType: "route", actionValue: "/campus" });

    // Assert
    expect(JSON.stringify(postToFcmFunction.mock.calls[0][0])).toBe(
      '{"type":"miniapp","miniAppId":"eskara-2026","notificationId":"n1","title_ko":"제목","body_ko":"본문","title_en":null,"body_en":null,"actionType":"route","actionValue":"/campus"}',
    );
  });

  it("forces nothing about topics — the function receives miniAppId, never a topics array", async () => {
    // Arrange
    postToFcmFunction.mockResolvedValue({ sent: 1 });

    // Act
    await new MiniappsNotificationsClient().sendPush(ROW);

    // Assert
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.miniAppId).toBe("eskara-2026");
    expect(payload.type).toBe("miniapp");
    expect(payload).not.toHaveProperty("topics");
  });

  it("passes the row's id as the notificationId, and no action when the row has none", async () => {
    // Arrange
    postToFcmFunction.mockResolvedValue({ sent: 1 });

    // Act
    await new MiniappsNotificationsClient().sendPush(ROW);

    // Assert
    const payload = postToFcmFunction.mock.calls[0][0];
    expect(payload.notificationId).toBe(ROW._id);
    expect(payload).not.toHaveProperty("actionType");
  });

  it("returns the function's counts", async () => {
    // Arrange
    postToFcmFunction.mockResolvedValue({ sent: 12, failed: 1, cleanedUp: 1, extra: "ignored" });

    // Act & Assert
    await expect(new MiniappsNotificationsClient().sendPush(ROW)).resolves.toEqual({ sent: 12, failed: 1, cleanedUp: 1 });
  });

  it("reads a count the function left out as 0", async () => {
    // Arrange
    postToFcmFunction.mockResolvedValue({ sent: 3 });

    // Act & Assert
    await expect(new MiniappsNotificationsClient().sendPush(ROW)).resolves.toEqual({ sent: 3, failed: 0, cleanedUp: 0 });
  });

  it("rejects with the call's own error", async () => {
    // Arrange
    const refused = Object.assign(new Error("sendNotification 400: bad"), { status: 400 });
    postToFcmFunction.mockRejectedValue(refused);

    // Act & Assert
    await expect(new MiniappsNotificationsClient().sendPush(ROW)).rejects.toBe(refused);
  });
});
