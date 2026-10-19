/**
 * In-memory MapLayerSetRepository: the content database's `datasets`, one
 * document per dataset name. findLayerSets reads as the real read does (pinned
 * in src/map/layer-set/map-layer-set.repository.spec.ts): the `map-layer-sets`
 * document's revision and data only, parsed with the same schema, so each bad
 * or repeated set is left out and named in `rejected`, and a missing or
 * invalid envelope reads as `null`. `storeLayerSets` stores data unchecked at
 * the next revision, as `npm run data` would without its checks, so a test can
 * seed an invalid one. `failWith` makes the next reads reject, as a database
 * error would, wrapped in MapLayerSetsReadError as the real read wraps it;
 * `readCount` counts the reads that reached the store.
 */
import { MAP_LAYER_SETS_DATASET } from "../../../../src/map/layer-set/map-layer-set.constants";
import { MapLayerSetsReadError } from "../../../../src/map/layer-set/map-layer-set.error";
import type { MapLayerSetRepository } from "../../../../src/map/layer-set/map-layer-set.repository";
import { storedLayerSets } from "../../../../src/map/layer-set/map-layer-set.schema";
import type { MapLayerSetsRevision } from "../../../../src/map/layer-set/map-layer-set.types";
import type { PublicOf } from "../public-of";

export class FakeMapLayerSetRepository implements PublicOf<MapLayerSetRepository> {
  datasets = new Map<string, { revision: unknown; data: unknown }>();
  failWith: Error | null = null;
  readCount = 0;

  /** Stores `data` as the next revision of `map-layer-sets`, unchecked, and returns that revision. */
  storeLayerSets(data: unknown): number {
    const current = this.datasets.get(MAP_LAYER_SETS_DATASET);
    const revision = typeof current?.revision === "number" ? current.revision + 1 : 1;
    this.datasets.set(MAP_LAYER_SETS_DATASET, { revision, data: structuredClone(data) });
    return revision;
  }

  async findLayerSets(): Promise<MapLayerSetsRevision | null> {
    if (this.failWith) throw new MapLayerSetsReadError(this.failWith);
    this.readCount += 1;
    const doc = this.datasets.get(MAP_LAYER_SETS_DATASET);
    if (doc === undefined) return null;
    const parsed = storedLayerSets.safeParse(structuredClone({ revision: doc.revision, data: doc.data }));
    return parsed.success ? { revision: parsed.data.revision, ...parsed.data.data } : null;
  }
}
