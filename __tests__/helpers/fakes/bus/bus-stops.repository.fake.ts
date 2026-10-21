/**
 * In-memory BusStopsRepository: the content database's `bus-stops` dataset.
 * The read reads as the real one does (pinned in
 * src/bus/stops/bus-stops.repository.spec.ts): the revision and data only,
 * parsed with the same schema, so a missing or invalid document reads as
 * `null`. `storeStops` stores data unchecked at the next revision, as
 * `npm run data` would without its checks, so a test can seed an invalid one.
 * `failWith` makes the next reads reject, as a database error would, wrapped
 * in BusStopsReadError as the real read wraps it; `readCount` counts the reads
 * that reached the store.
 */
import type { StoredBusStops } from "../../../../src/bus/stops/bus-stops.document";
import { BusStopsReadError } from "../../../../src/bus/stops/bus-stops.error";
import type { BusStopsRepository } from "../../../../src/bus/stops/bus-stops.repository";
import { storedBusStops } from "../../../../src/bus/stops/bus-stops.schema";
import type { PublicOf } from "../public-of";

export class FakeBusStopsRepository implements PublicOf<BusStopsRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `bus-stops`, unchecked, and returns that revision. */
  storeStops(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findStops(): Promise<StoredBusStops | null> {
    if (this.failWith) throw new BusStopsReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedBusStops.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
