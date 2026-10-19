/**
 * In-memory MiniappsRepository: the content database's `datasets`, one
 * document per dataset name. findRegistry reads as the real read does (pinned
 * in src/miniapps/miniapps.repository.spec.ts): the `miniapps` document's
 * revision and data only, parsed with the same schema, so a missing or
 * invalid document reads as `null`. `storeRegistry` stores data unchecked at
 * the next revision, as `npm run data` would without its checks, so a test
 * can seed an invalid one; `seededWith(data)` builds a fake holding it as
 * revision 1. `failWith` makes the next reads reject, as a database error
 * would, wrapped in MiniappsRegistryReadError as the real read wraps it;
 * `readCount` counts the reads that reached the store.
 */
import { MINIAPPS_DATASET } from "../../../../src/miniapps/miniapps.constants";
import { MiniappsRegistryReadError } from "../../../../src/miniapps/miniapps.error";
import type { MiniappsRepository } from "../../../../src/miniapps/miniapps.repository";
import { storedRegistry } from "../../../../src/miniapps/miniapps.schema";
import type { MiniAppsRegistryRevision } from "../../../../src/miniapps/miniapps.types";
import type { PublicOf } from "../public-of";

export class FakeMiniappsRepository implements PublicOf<MiniappsRepository> {
  datasets = new Map<string, { revision: unknown; data: unknown }>();
  failWith: Error | null = null;
  readCount = 0;

  static seededWith(data: unknown): FakeMiniappsRepository {
    const repository = new FakeMiniappsRepository();
    repository.storeRegistry(data);
    return repository;
  }

  /** Stores `data` as the next revision of `miniapps`, unchecked, and returns that revision. */
  storeRegistry(data: unknown): number {
    const current = this.datasets.get(MINIAPPS_DATASET);
    const revision = typeof current?.revision === "number" ? current.revision + 1 : 1;
    this.datasets.set(MINIAPPS_DATASET, { revision, data: structuredClone(data) });
    return revision;
  }

  async findRegistry(): Promise<MiniAppsRegistryRevision | null> {
    if (this.failWith) throw new MiniappsRegistryReadError(this.failWith);
    this.readCount += 1;
    const doc = this.datasets.get(MINIAPPS_DATASET);
    if (doc === undefined) return null;
    const parsed = storedRegistry.safeParse(structuredClone({ revision: doc.revision, data: doc.data }));
    return parsed.success ? { revision: parsed.data.revision, registry: parsed.data.data } : null;
  }
}
