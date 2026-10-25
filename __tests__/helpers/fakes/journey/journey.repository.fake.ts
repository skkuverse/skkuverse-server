/**
 * In-memory JourneyRepository: the content database's `journey-routes`
 * dataset. The read reads as the real one does (pinned in
 * src/journey/journey.repository.spec.ts): the revision and data only, parsed
 * with the same schema, so a missing or invalid document reads as `null`.
 * `storeRoutes` stores data unchecked at the next revision, as `npm run data`
 * would without its checks, so a test can seed an invalid one. `failWith`
 * makes the next reads reject, as a database error would, wrapped in
 * JourneyRoutesReadError as the real read wraps it; `readCount` counts the
 * reads that reached the store.
 */
import type { StoredJourneyRoutes } from "../../../../src/journey/journey.document";
import { JourneyRoutesReadError } from "../../../../src/journey/journey.error";
import type { JourneyRepository } from "../../../../src/journey/journey.repository";
import { storedJourneyRoutes } from "../../../../src/journey/journey.schema";
import type { PublicOf } from "../public-of";

export class FakeJourneyRepository implements PublicOf<JourneyRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `journey-routes`, unchecked, and returns that revision. */
  storeRoutes(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findRoutes(): Promise<StoredJourneyRoutes | null> {
    if (this.failWith) throw new JourneyRoutesReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedJourneyRoutes.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
