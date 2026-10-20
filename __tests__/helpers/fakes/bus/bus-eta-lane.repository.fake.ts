/**
 * In-memory BusEtaLaneRepository: the content database's `bus-lane-corridor`
 * dataset. The read reads as the real one does (pinned in
 * src/bus/eta/lane/bus-eta-lane.repository.spec.ts): the revision and data
 * only, parsed with the same schema, so a missing or invalid document reads as
 * `null`. `storeCorridor` stores data unchecked at the next revision, as
 * `npm run data` would without its checks, so a test can seed an invalid one.
 * `failWith` makes the next reads reject, as a database error would, wrapped
 * in BusEtaLaneReadError as the real read wraps it; `readCount` counts the
 * reads that reached the store.
 */
import { BusEtaLaneReadError } from "../../../../src/bus/eta/lane/bus-eta-lane.error";
import type { StoredLaneCorridor } from "../../../../src/bus/eta/lane/bus-eta-lane.document";
import type { BusEtaLaneRepository } from "../../../../src/bus/eta/lane/bus-eta-lane.repository";
import { storedLaneCorridor } from "../../../../src/bus/eta/lane/bus-eta-lane.schema";
import type { PublicOf } from "../public-of";

export class FakeBusEtaLaneRepository implements PublicOf<BusEtaLaneRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `bus-lane-corridor`, unchecked, and returns that revision. */
  storeCorridor(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findCorridor(): Promise<StoredLaneCorridor | null> {
    if (this.failWith) throw new BusEtaLaneReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedLaneCorridor.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
