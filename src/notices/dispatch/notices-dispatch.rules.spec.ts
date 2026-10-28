/**
 * Dispatch decisions over the push fields: the claim window (a KST day floor, the lease cutoff, the attempt
 * cap), the field values of a push, a skip and a release, the cluster key that groups a sweep's copies, and the
 * group's representative. Its Mongo form is
 * notices-dispatch.query.ts, pinned by the repository spec.
 */
import { ObjectId } from "mongodb";
import { clusterKeyOf, groupByClusterKey, selectRepresentative, toClaimWindow, toPushedFields, toReleasedFields, toSkippedFields } from "./notices-dispatch.rules";

const POLICY = { maxAgeDays: 14, claimLeaseMs: 10 * 60_000, maxAttempts: 5 };

describe("toClaimWindow", () => {
  it("floors the age gate on the KST day, which is a day after the UTC one at 01:30 KST", () => {
    // Act
    const window = toClaimWindow(new Date("2026-10-19T16:30:00Z"), POLICY);

    // Assert
    expect(window.dateFloor).toBe("2026-10-06");
    expect(window.dateFloor).not.toBe("2026-10-05");
    expect(window.leaseExpiredBefore).toEqual(new Date("2026-10-19T16:20:00Z"));
    expect(window.maxAttempts).toBe(5);
  });
});

describe("toPushedFields", () => {
  it("marks pushed at the time given, releases the lease and clears the error", () => {
    // Act & Assert
    expect(toPushedFields(new Date("2026-10-19T16:30:00Z"))).toEqual({ pushedAt: new Date("2026-10-19T16:30:00Z"), dispatchClaimedAt: null, pushError: null });
  });
});

describe("toSkippedFields", () => {
  it("resolves the notice at the time given with the no-topic reason, releases the lease and clears the error", () => {
    // Act & Assert
    expect(toSkippedFields(new Date("2026-10-19T16:30:00Z"))).toEqual({
      pushedAt: new Date("2026-10-19T16:30:00Z"),
      pushSkippedReason: "no-topic",
      dispatchClaimedAt: null,
      pushError: null,
    });
  });
});

describe("toReleasedFields", () => {
  it("releases the lease and keeps the error's message, cut at 500 characters", () => {
    // Act & Assert
    expect([toReleasedFields(new Error("x".repeat(600))).pushError.length, toReleasedFields("plain").pushError]).toEqual([500, "plain"]);
  });
});

describe("selectRepresentative", () => {
  const doc = (sourceId: string) => ({ _id: new ObjectId(), sourceId });

  it("takes the lowest sourceId among members with a topic, else the first member", () => {
    // Arrange
    const members = [doc("skku-notice07"), doc("skku-main"), doc("skku-notice02")];

    // Act & Assert
    expect(selectRepresentative(members, (m) => m.sourceId !== "skku-main").sourceId).toBe("skku-notice02");
    expect(selectRepresentative(members, () => false).sourceId).toBe("skku-notice07");
  });

  it("refuses an empty group rather than sending a push for nobody", () => {
    // Act & Assert
    expect(() => selectRepresentative([], () => true)).toThrow("a push group has no members");
  });
});

describe("clusterKeyOf", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

  it.each([
    ["the crawler's dupOf", { _id: id(2), dupOf: id(1) }, id(1)],
    ["its own _id when the crawler has not linked it yet", { _id: id(2) }, id(2)],
    ["its own _id when dupOf is null", { _id: id(2), dupOf: null }, id(2)],
  ])("keys a notice on %s", (_case, notice, anchor) => {
    // Act & Assert
    expect(clusterKeyOf(notice)).toBe(anchor.toHexString());
  });
});

describe("groupByClusterKey", () => {
  const id = (n: number) => new ObjectId(n.toString(16).padStart(24, "0"));

  it("groups the notices whose key is equal, each group in the order given, the groups in order of their first notice", () => {
    // Arrange
    const notices = [{ _id: id(3), dupOf: id(1) }, { _id: id(4), dupOf: id(4) }, { _id: id(1), dupOf: id(1) }, { _id: id(5) }];

    // Act
    const groups = groupByClusterKey(notices);

    // Assert
    expect(groups.map((group) => group.map((notice) => notice._id))).toEqual([[id(3), id(1)], [id(4)], [id(5)]]);
  });

  it("forms no group from no notices", () => {
    // Act & Assert
    expect(groupByClusterKey([])).toEqual([]);
  });
});
