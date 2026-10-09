/**
 * `bus_campus.shuttle_eta`: travel times for scheduled runs (design D9), one
 * document per run and source.
 *
 * A document holds offsets from the departure, not clock times, so the served
 * time is the departure plus the offset and one document serves every bus that
 * leaves at that time. A document whose `offsetsSec` no longer fits the
 * sequence (the catalog changed between ticks) is ignored when serving.
 *
 * The TTL index on `expiresAt` enforces TMAP's terms: a prediction is never
 * stored 24 hours past its fetch. The reader also filters on `expiresAt`,
 * because a TTL sweep can lag by a minute.
 */
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { getClient, HOT_READ_MAX_TIME_MS } from "../../infra/db";
import type { EtaRun } from "./eta-runs";

export type EtaKind = "baseline" | "live";

export interface ShuttleEtaDoc {
  _id: string; // `${serviceId}|${routeType}|${date}|${time}|${kind}`
  kind: EtaKind;
  serviceId: string;
  routeType: string;
  date: string;
  time: string;
  departAt: Date;
  // Cumulative seconds from the first stop, one per sequence stop.
  offsetsSec: number[];
  source: "naver" | "tmap";
  fetchedAt: Date;
  frozen?: true;
  frozenAt?: Date;
  expiresAt: Date;
}

const COLLECTION = "shuttle_eta";
const BASELINE_LIFE_MS = 24 * 60 * 60_000; // TMAP: no use 24 h after fetching
const LIVE_LIFE_MS = 8 * 24 * 60 * 60_000; // a fixed value is served for 7 days after its run

type RunKey = Pick<EtaRun, "serviceId" | "routeType" | "date" | "time">;

export function etaDocId(run: RunKey, kind: EtaKind): string {
  return `${run.serviceId}|${run.routeType}|${run.date}|${run.time}|${kind}`;
}

/** A TMAP prediction for one run. */
export function baselineDoc(run: EtaRun, offsetsSec: number[], fetchedAt: Date): ShuttleEtaDoc {
  return {
    _id: etaDocId(run, "baseline"),
    kind: "baseline",
    serviceId: run.serviceId,
    routeType: run.routeType,
    date: run.date,
    time: run.time,
    departAt: run.departAt,
    offsetsSec,
    source: "tmap",
    fetchedAt,
    expiresAt: new Date(fetchedAt.getTime() + BASELINE_LIFE_MS),
  };
}

/** A NAVER real-time value for one run; `frozenAt` fixes it for good. */
export function liveDoc(run: EtaRun, offsetsSec: number[], fetchedAt: Date, frozenAt?: Date): ShuttleEtaDoc {
  return {
    _id: etaDocId(run, "live"),
    kind: "live",
    serviceId: run.serviceId,
    routeType: run.routeType,
    date: run.date,
    time: run.time,
    departAt: run.departAt,
    offsetsSec,
    source: "naver",
    fetchedAt,
    ...(frozenAt ? { frozen: true as const, frozenAt } : {}),
    expiresAt: new Date(run.departAt.getTime() + LIVE_LIFE_MS),
  };
}

function collection(): Collection<ShuttleEtaDoc> {
  return getClient().db(config.mongo.dbName!).collection<ShuttleEtaDoc>(COLLECTION);
}

/** The TTL index and the poller's lookup index. Idempotent. */
export async function ensureEtaIndexes(): Promise<void> {
  const coll = collection();
  await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" });
  await coll.createIndex({ serviceId: 1, date: 1, kind: 1 }, { name: "serviceId_date_kind" });
}

/**
 * Upserts documents by `_id`, leaving any already-frozen one untouched. Refuses
 * the whole batch when a document's offsets do not fit its sequence, which
 * would be a parser bug, not data.
 */
export async function writeEtas(
  docs: ShuttleEtaDoc[],
  sequenceLength: (serviceId: string, routeType: string) => number | undefined,
): Promise<{ written: number; skippedFrozen: number }> {
  for (const doc of docs) {
    const expected = sequenceLength(doc.serviceId, doc.routeType);
    if (doc.offsetsSec.length !== expected) {
      throw new Error(
        `shuttle_eta ${doc._id}: ${doc.offsetsSec.length} offsets for a sequence of ${expected ?? "no"} stops`,
      );
    }
  }
  if (docs.length === 0) return { written: 0, skippedFrozen: 0 };

  const coll = collection();
  // One poller process writes, so reading first is enough to keep a fixed value fixed.
  const frozen = await coll
    .find({ _id: { $in: docs.map((d) => d._id) }, frozen: true }, { projection: { _id: 1 } })
    .toArray();
  const frozenIds = new Set(frozen.map((d) => d._id));
  const toWrite = docs.filter((d) => !frozenIds.has(d._id));
  if (toWrite.length > 0) {
    await coll.bulkWrite(
      toWrite.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
      { ordered: false },
    );
  }
  return { written: toWrite.length, skippedFrozen: docs.length - toWrite.length };
}

/** The documents of some services on some dates, expired or not: what the pollers decide from. */
export async function readEtas(serviceIds: string[], dates: string[]): Promise<ShuttleEtaDoc[]> {
  return collection()
    .find({ serviceId: { $in: serviceIds }, date: { $in: dates } })
    .toArray();
}

/** Every unexpired document: the serving read, on the request path. */
export async function readUnexpiredEtas(now: Date): Promise<ShuttleEtaDoc[]> {
  return collection()
    .find({ expiresAt: { $gt: now } }, { maxTimeMS: HOT_READ_MAX_TIME_MS })
    .toArray();
}
