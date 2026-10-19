/**
 * In-memory UiHomeRepository: the content database's `datasets`, one document
 * per dataset name. findHomeLayout reads as the real read does (pinned in
 * src/ui/home/ui-home.repository.spec.ts): the `home-layout` document's
 * revision and data only, parsed with the same schema, so a missing or invalid
 * document reads as `null`. `storeHomeLayout` stores data unchecked at the next
 * revision, as `npm run data` would without its checks, so a test can seed an
 * invalid one. `failWith` makes the next reads reject, as a database error
 * would; `readCount` counts the reads that reached the store.
 */
import { HOME_LAYOUT_DATASET } from "../../../../src/ui/home/ui-home.constants";
import type { UiHomeRepository } from "../../../../src/ui/home/ui-home.repository";
import { storedHomeLayout } from "../../../../src/ui/home/ui-home.schema";
import type { HomeLayoutRevision } from "../../../../src/ui/home/ui-home.types";
import type { PublicOf } from "../public-of";

export class FakeUiHomeRepository implements PublicOf<UiHomeRepository> {
  datasets = new Map<string, { revision: unknown; data: unknown }>();
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `home-layout`, unchecked, and returns that revision. */
  storeHomeLayout(data: unknown): number {
    const current = this.datasets.get(HOME_LAYOUT_DATASET);
    const revision = typeof current?.revision === "number" ? current.revision + 1 : 1;
    this.datasets.set(HOME_LAYOUT_DATASET, { revision, data: structuredClone(data) });
    return revision;
  }

  async findHomeLayout(): Promise<HomeLayoutRevision | null> {
    if (this.failWith) throw this.failWith;
    this.readCount += 1;
    const doc = this.datasets.get(HOME_LAYOUT_DATASET);
    if (doc === undefined) return null;
    const parsed = storedHomeLayout.safeParse(structuredClone({ revision: doc.revision, data: doc.data }));
    return parsed.success ? { revision: parsed.data.revision, layout: parsed.data.data } : null;
  }
}
