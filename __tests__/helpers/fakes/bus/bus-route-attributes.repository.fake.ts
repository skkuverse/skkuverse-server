/**
 * In-memory BusRouteAttributesRepository: the content database's
 * `jongro-route-attributes` dataset. The read reads as the real one does
 * (pinned in src/bus/route-attributes/bus-route-attributes.repository.spec.ts):
 * the revision and data only, parsed with the same schema, so a missing or
 * invalid document reads as `null`. `storeAttributes` stores data unchecked at
 * the next revision, as `npm run data` would without its checks, so a test can
 * seed an invalid one. `failWith` makes the next reads reject, as a database
 * error would, wrapped in BusRouteAttributesReadError as the real read wraps
 * it; `readCount` counts the reads that reached the store.
 */
import { BusRouteAttributesReadError } from "../../../../src/bus/route-attributes/bus-route-attributes.error";
import type { StoredRouteAttributes } from "../../../../src/bus/route-attributes/bus-route-attributes.document";
import type { BusRouteAttributesRepository } from "../../../../src/bus/route-attributes/bus-route-attributes.repository";
import { storedRouteAttributes } from "../../../../src/bus/route-attributes/bus-route-attributes.schema";
import type { PublicOf } from "../public-of";

export class FakeBusRouteAttributesRepository implements PublicOf<BusRouteAttributesRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `jongro-route-attributes`, unchecked, and returns that revision. */
  storeAttributes(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findAttributes(): Promise<StoredRouteAttributes | null> {
    if (this.failWith) throw new BusRouteAttributesReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedRouteAttributes.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
