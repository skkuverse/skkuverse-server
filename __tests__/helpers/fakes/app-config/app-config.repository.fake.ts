/**
 * In-memory AppConfigRepository: the content database's `app-platform-gates`
 * dataset. The read reads as the real one does (pinned in
 * src/app-config/app-config.repository.spec.ts): the revision and data only,
 * parsed with the same schema, so a missing or invalid document reads as
 * `null`. `storePlatformGates` stores data unchecked at the next revision, as
 * `npm run data` would without its checks, so a test can seed an invalid one.
 * `failWith` makes the next reads reject, as a database error would, wrapped
 * in AppConfigPlatformGatesReadError as the real read wraps it; `readCount`
 * counts the reads that reached the store.
 */
import type { StoredAppPlatformGates } from "../../../../src/app-config/app-config.document";
import { AppConfigPlatformGatesReadError } from "../../../../src/app-config/app-config.error";
import type { AppConfigRepository } from "../../../../src/app-config/app-config.repository";
import { storedAppPlatformGates } from "../../../../src/app-config/app-config.schema";
import type { PublicOf } from "../public-of";

export class FakeAppConfigRepository implements PublicOf<AppConfigRepository> {
  stored: { revision: unknown; data: unknown } | null = null;
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `app-platform-gates`, unchecked, and returns that revision. */
  storePlatformGates(data: unknown): number {
    const revision = typeof this.stored?.revision === "number" ? this.stored.revision + 1 : 1;
    this.stored = { revision, data: structuredClone(data) };
    return revision;
  }

  async findPlatformGates(): Promise<StoredAppPlatformGates | null> {
    if (this.failWith) throw new AppConfigPlatformGatesReadError(this.failWith);
    this.readCount += 1;
    if (this.stored === null) return null;
    const parsed = storedAppPlatformGates.safeParse(structuredClone(this.stored));
    return parsed.success ? parsed.data : null;
  }
}
