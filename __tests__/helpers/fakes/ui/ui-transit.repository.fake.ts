/**
 * In-memory UiTransitRepository: the content database's `datasets`, one
 * document per dataset name. findTransitLayout reads as the real read does
 * (pinned in src/ui/transit/ui-transit.repository.spec.ts): the `transit-layout`
 * document's revision and data only, parsed with the same schema, so a missing
 * or invalid document reads as `null`. `storeTransitLayout` stores data
 * unchecked at the next revision, as `npm run data` would without its checks,
 * so a test can seed an invalid one. `failWith` makes the next reads reject, as
 * a database error would, wrapped in UiTransitLayoutReadError as the real read
 * wraps it; `readCount` counts the reads that reached the store.
 */
import { TRANSIT_LAYOUT_DATASET } from "../../../../src/ui/transit/ui-transit.constants";
import { UiTransitLayoutReadError } from "../../../../src/ui/transit/ui-transit.error";
import type { UiTransitRepository } from "../../../../src/ui/transit/ui-transit.repository";
import { storedTransitLayout } from "../../../../src/ui/transit/ui-transit.schema";
import type { TransitLayoutRevision } from "../../../../src/ui/transit/ui-transit.types";
import type { PublicOf } from "../public-of";

export class FakeUiTransitRepository implements PublicOf<UiTransitRepository> {
  datasets = new Map<string, { revision: unknown; data: unknown }>();
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `transit-layout`, unchecked, and returns that revision. */
  storeTransitLayout(data: unknown): number {
    const current = this.datasets.get(TRANSIT_LAYOUT_DATASET);
    const revision = typeof current?.revision === "number" ? current.revision + 1 : 1;
    this.datasets.set(TRANSIT_LAYOUT_DATASET, { revision, data: structuredClone(data) });
    return revision;
  }

  async findTransitLayout(): Promise<TransitLayoutRevision | null> {
    if (this.failWith) throw new UiTransitLayoutReadError(this.failWith);
    this.readCount += 1;
    const doc = this.datasets.get(TRANSIT_LAYOUT_DATASET);
    if (doc === undefined) return null;
    const parsed = storedTransitLayout.safeParse(structuredClone({ revision: doc.revision, data: doc.data }));
    return parsed.success ? { revision: parsed.data.revision, layout: parsed.data.data } : null;
  }
}
