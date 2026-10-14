/**
 * NoticesDispatchRepository's driver calls, the only writes of the four push fields: the atomic claim's filter
 * and lease stamp, and the pushed and released records, each with one attempt counted. Over a real mongod they
 * are pinned by notices-characterization.routes.test.ts.
 */
const findOneAndUpdate = jest.fn((..._args: unknown[]) => Promise.resolve(null));
const updateOne = jest.fn((..._args: unknown[]) => Promise.resolve({ acknowledged: true }));

jest.mock("../../infra/db", () => ({
  getClient: () => ({ db: () => ({ collection: () => ({ findOneAndUpdate, updateOne }) }) }),
}));

import { ObjectId } from "mongodb";
import { NoticesDispatchRepository } from "./notices-dispatch.repository";

const CLAIMED_AT = new Date("2026-10-19T16:30:00Z");
const LEASE = new Date("2026-10-19T16:20:00Z");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("NoticesDispatchRepository.claimNextPending", () => {
  it("claims an unpushed, summarized, recent, undeleted notice under its attempt cap whose lease is free or expired", async () => {
    // Act
    await new NoticesDispatchRepository().claimNextPending({ dateFloor: "2026-10-06", leaseExpiredBefore: LEASE, maxAttempts: 5 }, CLAIMED_AT);

    // Assert
    expect(findOneAndUpdate.mock.calls[0]).toEqual([
      {
        pushedAt: null,
        aiSummaryAt: { $type: "date" },
        date: { $gte: "2026-10-06" },
        pushAttempts: { $not: { $gte: 5 } },
        isDeleted: { $ne: true },
        $or: [{ dispatchClaimedAt: null }, { dispatchClaimedAt: { $exists: false } }, { dispatchClaimedAt: { $lt: LEASE } }],
      },
      { $set: { dispatchClaimedAt: CLAIMED_AT } },
      { returnDocument: "after" },
    ]);
  });
});

describe("NoticesDispatchRepository records", () => {
  const id = new ObjectId();

  it("records a push: pushed, lease released, error cleared, one more attempt", async () => {
    // Act
    await new NoticesDispatchRepository().recordPushed(id, { pushedAt: CLAIMED_AT, dispatchClaimedAt: null, pushError: null });

    // Assert
    expect(updateOne).toHaveBeenCalledWith(
      { _id: id },
      { $set: { pushedAt: CLAIMED_AT, dispatchClaimedAt: null, pushError: null }, $inc: { pushAttempts: 1 } },
    );
  });

  it("records a release: lease released, the error kept, one more attempt, pushedAt untouched", async () => {
    // Act
    await new NoticesDispatchRepository().recordReleased(id, { dispatchClaimedAt: null, pushError: "boom" });

    // Assert
    expect(updateOne).toHaveBeenCalledWith({ _id: id }, { $set: { dispatchClaimedAt: null, pushError: "boom" }, $inc: { pushAttempts: 1 } });
  });
});
