/**
 * The shuttle_eta store (design D9): ids, expiry, the frozen skip, the
 * offsets-length guard and the indexes. Mongo is mocked.
 */
jest.mock("../../../src/infra/db", () => ({ getClient: jest.fn(), HOT_READ_MAX_TIME_MS: 3_000 }));
jest.mock("../../../src/infra/config", () => ({ mongo: { dbName: "bus_campus_test" } }));

import {
  baselineDoc,
  ensureEtaIndexes,
  etaDocId,
  liveDoc,
  readUnexpiredEtas,
  writeEtas,
} from "../../../src/bus/eta/eta-store";
import type { EtaRun } from "../../../src/bus/eta/eta-runs";

const { getClient } = require("../../../src/infra/db");

const RUN: EtaRun = {
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-12",
  time: "10:00",
  departAt: new Date("2026-10-12T01:00:00.000Z"),
};
const FETCHED = new Date("2026-10-12T00:20:00.000Z");
const seqLength = (serviceId: string, routeType: string) =>
  serviceId === "campus-inja" && routeType === "regular" ? 3 : undefined;

let frozenInDb: Array<{ _id: string }>;
const coll = {
  find: jest.fn(() => ({ toArray: async () => frozenInDb })),
  bulkWrite: jest.fn(async () => ({})),
  createIndex: jest.fn(async () => "ok"),
};
const db = { collection: jest.fn(() => coll) };

beforeEach(() => {
  frozenInDb = [];
  jest.clearAllMocks();
  getClient.mockReturnValue({ db: jest.fn(() => db) });
});

describe("documents", () => {
  it("are keyed by run and source", () => {
    expect(etaDocId(RUN, "live")).toBe("campus-inja|regular|2026-10-12|10:00|live");
  });

  it("a prediction expires 24 hours after its fetch (TMAP terms)", () => {
    const doc = baselineDoc(RUN, [0, 3000, 3200], FETCHED);
    expect(doc).toMatchObject({ _id: "campus-inja|regular|2026-10-12|10:00|baseline", kind: "baseline", source: "tmap" });
    expect(doc.expiresAt.toISOString()).toBe("2026-10-13T00:20:00.000Z");
    expect(doc).not.toHaveProperty("frozen");
  });

  it("a live value expires 8 days after its departure; a frozen one says when it was fixed", () => {
    const live = liveDoc(RUN, [0, 3000, 3200], FETCHED);
    expect(live.expiresAt.toISOString()).toBe("2026-10-20T01:00:00.000Z");
    expect(live).not.toHaveProperty("frozen");
    const frozenAt = new Date("2026-10-12T01:00:30.000Z");
    expect(liveDoc(RUN, [0, 3000, 3200], frozenAt, frozenAt)).toMatchObject({ frozen: true, frozenAt, source: "naver" });
  });
});

describe("writeEtas", () => {
  it("upserts by _id", async () => {
    const doc = liveDoc(RUN, [0, 3000, 3200], FETCHED);
    await expect(writeEtas([doc], seqLength)).resolves.toEqual({ written: 1, skippedFrozen: 0 });
    expect(coll.bulkWrite).toHaveBeenCalledWith(
      [{ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }],
      { ordered: false },
    );
    expect(db.collection).toHaveBeenCalledWith("shuttle_eta");
  });

  it("skips a document that is already frozen", async () => {
    const doc = liveDoc(RUN, [0, 3000, 3200], FETCHED);
    frozenInDb = [{ _id: doc._id }];
    await expect(writeEtas([doc], seqLength)).resolves.toEqual({ written: 0, skippedFrozen: 1 });
    expect(coll.find).toHaveBeenCalledWith({ _id: { $in: [doc._id] }, frozen: true }, { projection: { _id: 1 } });
    expect(coll.bulkWrite).not.toHaveBeenCalled();
  });

  it("rejects offsets that do not fit the sequence, before writing anything", async () => {
    const good = liveDoc(RUN, [0, 3000, 3200], FETCHED);
    const bad = liveDoc({ ...RUN, time: "12:00" }, [0, 3000], FETCHED);
    await expect(writeEtas([good, bad], seqLength)).rejects.toThrow(
      "shuttle_eta campus-inja|regular|2026-10-12|12:00|live: 2 offsets for a sequence of 3 stops",
    );
    expect(coll.bulkWrite).not.toHaveBeenCalled();
  });

  it("writes nothing for an empty batch", async () => {
    await expect(writeEtas([], seqLength)).resolves.toEqual({ written: 0, skippedFrozen: 0 });
    expect(coll.find).not.toHaveBeenCalled();
  });
});

describe("reading and indexes", () => {
  it("reads only unexpired documents, capped like every hot read", async () => {
    const now = new Date("2026-10-12T02:00:00.000Z");
    await readUnexpiredEtas(now);
    expect(coll.find).toHaveBeenCalledWith({ expiresAt: { $gt: now } }, { maxTimeMS: 3_000 });
  });

  it("creates the TTL index on expiresAt and the poller's lookup index", async () => {
    await ensureEtaIndexes();
    expect(coll.createIndex).toHaveBeenCalledWith({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
    expect(coll.createIndex).toHaveBeenCalledWith({ serviceId: 1, date: 1, kind: 1 }, { name: "serviceId_date_kind" });
  });
});
