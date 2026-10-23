/**
 * In-memory BusHsscRouteLineRepository: the content database's `hssc-route-line` dataset. The read reads as the
 * real one does (pinned in src/bus/hssc-route-line/bus-hssc-route-line.repository.spec.ts): the revision and data
 * only, parsed with the same schema, so a missing or invalid document reads as `null`. `storeRouteLine` stores data
 * unchecked at the next revision, as `npm run data` would without its checks. `failWith` makes the next reads
 * reject, wrapped in BusHsscRouteLineReadError as the real read wraps a database error.
 */
import type { StoredHsscRouteLine } from "../../../../src/bus/hssc-route-line/bus-hssc-route-line.document";
import { BusHsscRouteLineReadError } from "../../../../src/bus/hssc-route-line/bus-hssc-route-line.error";
import type { BusHsscRouteLineRepository } from "../../../../src/bus/hssc-route-line/bus-hssc-route-line.repository";
import { storedHsscRouteLine } from "../../../../src/bus/hssc-route-line/bus-hssc-route-line.schema";
import type { PublicOf } from "../public-of";

export class FakeBusHsscRouteLineRepository implements PublicOf<BusHsscRouteLineRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;

  /** Stores `data` as the next revision of `hssc-route-line`, unchecked, and returns that revision. */
  storeRouteLine(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findRouteLine(): Promise<StoredHsscRouteLine | null> {
    if (this.failWith) throw new BusHsscRouteLineReadError(this.failWith);
    if (this.stored === null) return null;
    const parsed = storedHsscRouteLine.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
