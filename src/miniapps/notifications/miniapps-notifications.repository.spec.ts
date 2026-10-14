/**
 * MiniappsNotificationsRepository's driver calls: the feed read's filter, bound,
 * sort and limit (which FakeMiniappsNotificationsRepository follows), the two
 * record writes as `$set` of one field on one row, and the boot index that
 * serves the read. These pin the query objects; what they match against real
 * data is for a mongod spec.
 */
const toArray = jest.fn().mockResolvedValue([]);
const limit = jest.fn(() => ({ toArray }));
const sort = jest.fn(() => ({ limit }));
const find = jest.fn(() => ({ sort }));
const insertOne = jest.fn().mockResolvedValue({});
const updateOne = jest.fn().mockResolvedValue({});
const createIndex = jest.fn().mockResolvedValue("ok");
const mongoCollection = jest.fn(() => ({ find, insertOne, updateOne, createIndex }));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../infra/logger", () => mockLogger);
jest.mock("../../infra/mongo", () => ({ mongoCollection: (...args: unknown[]) => mongoCollection(...(args as [])) }));

import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import type { SentNotificationDoc } from "../miniapps.document";
import { MiniappsNotificationsRepository } from "./miniapps-notifications.repository";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("MiniappsNotificationsRepository.listSentNotifications", () => {
  it("reads one mini app's rows newest first, bounded, up to the limit", async () => {
    // Act
    await new MiniappsNotificationsRepository().listSentNotifications("eskara-2026", 50);

    // Assert
    expect(mongoCollection).toHaveBeenCalledWith(config.miniapps.dbName, "sent_notifications");
    expect(find).toHaveBeenCalledWith({ miniAppId: "eskara-2026" }, { maxTimeMS: HOT_READ_MAX_TIME_MS });
    expect(sort).toHaveBeenCalledWith({ sentAt: -1 });
    expect(limit).toHaveBeenCalledWith(50);
  });
});

describe("MiniappsNotificationsRepository writes", () => {
  it("inserts the row as given", async () => {
    // Arrange
    const doc = { _id: "n1", miniAppId: "a" } as SentNotificationDoc;

    // Act
    await new MiniappsNotificationsRepository().insertSentNotification(doc);

    // Assert
    expect(insertOne).toHaveBeenCalledWith(doc);
  });

  it("records a delivery as $set of delivery on that row", async () => {
    // Act
    await new MiniappsNotificationsRepository().recordDelivery("n1", { sent: 1, failed: 0, cleanedUp: 0 });

    // Assert
    expect(updateOne).toHaveBeenCalledWith({ _id: "n1" }, { $set: { delivery: { sent: 1, failed: 0, cleanedUp: 0 } } });
  });

  it("records a failure as $set of deliveryError on that row", async () => {
    // Act
    await new MiniappsNotificationsRepository().recordDeliveryFailure("n1", { outcome: "unknown", error: "x" });

    // Assert
    expect(updateOne).toHaveBeenCalledWith({ _id: "n1" }, { $set: { deliveryError: { outcome: "unknown", error: "x" } } });
  });
});

describe("MiniappsNotificationsRepository.onModuleInit", () => {
  it("creates the index the feed read uses", async () => {
    // Act
    await new MiniappsNotificationsRepository().onModuleInit();

    // Assert
    expect(createIndex).toHaveBeenCalledWith({ miniAppId: 1, sentAt: -1 });
  });

  it("warns and carries on when the index cannot be created", async () => {
    // Arrange
    createIndex.mockRejectedValueOnce(new Error("atlas down"));

    // Act
    await new MiniappsNotificationsRepository().onModuleInit();

    // Assert
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "miniapps.startup.init_failed" }), expect.any(String));
  });
});
