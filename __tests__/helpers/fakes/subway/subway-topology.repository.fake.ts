/**
 * In-memory SubwayTopologyRepository: the content database's
 * `subway-topology` dataset. The read reads as the real one does
 * (pinned in src/subway/topology/subway-topology.repository.spec.ts):
 * the revision and data only, parsed with the same schema, so a missing or
 * invalid document reads as `null`. `storeTopology` stores data unchecked at
 * the next revision, as `npm run data` would without its checks, so a test can
 * seed an invalid one. `failWith` makes the next reads reject, as a database
 * error would, wrapped in SubwayTopologyReadError as the real read wraps
 * it; `readCount` counts the reads that reached the store.
 */
import { SubwayTopologyReadError } from "../../../../src/subway/topology/subway-topology.error";
import type { StoredSubwayTopology } from "../../../../src/subway/topology/subway-topology.document";
import type { SubwayTopologyRepository } from "../../../../src/subway/topology/subway-topology.repository";
import { storedSubwayTopology } from "../../../../src/subway/topology/subway-topology.schema";
import type { PublicOf } from "../public-of";

export class FakeSubwayTopologyRepository implements PublicOf<SubwayTopologyRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `subway-topology`, unchecked, and returns that revision. */
  storeTopology(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findTopology(): Promise<StoredSubwayTopology | null> {
    if (this.failWith) throw new SubwayTopologyReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedSubwayTopology.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
