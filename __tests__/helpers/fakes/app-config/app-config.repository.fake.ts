/**
 * In-memory AppConfigRepository: the content database's `app-features`
 * dataset. The read reads as the real one does (pinned in
 * src/app-config/app-config.repository.spec.ts): the revision and data only,
 * parsed with the same schema, so a missing or invalid document reads as
 * `null`. `storeFeatures` stores data unchecked at the next revision, as
 * `npm run data` would without its checks, so a test can seed an invalid one.
 * `failWith` makes the next reads reject, as a database error would, wrapped
 * in AppConfigFeaturesReadError as the real read wraps it; `readCount` counts the
 * reads that reached the store.
 */
import type { StoredAppFeatures } from "../../../../src/app-config/app-config.document";
import { AppConfigFeaturesReadError } from "../../../../src/app-config/app-config.error";
import type { AppConfigRepository } from "../../../../src/app-config/app-config.repository";
import { storedAppFeatures } from "../../../../src/app-config/app-config.schema";
import type { PublicOf } from "../public-of";

export class FakeAppConfigRepository implements PublicOf<AppConfigRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `app-features`, unchecked, and returns that revision. */
  storeFeatures(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findFeatures(): Promise<StoredAppFeatures | null> {
    if (this.failWith) throw new AppConfigFeaturesReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedAppFeatures.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
