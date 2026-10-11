/**
 * In-memory MapRepository: activations and places, with the real reads'
 * filters and sort (pinned in src/map/map.repository.spec.ts). `failWith`
 * makes the next reads reject, as a database error would.
 */
import type { ActivationDoc, MapPlaceDoc } from "../../../../src/map/map.document";
import type { MapRepository } from "../../../../src/map/map.repository";
import type { PublicOf } from "../public-of";

const isOpenAt = (a: ActivationDoc, now: Date): boolean =>
  a.enabled && (a.activeFrom == null || a.activeFrom <= now) && (a.activeUntil == null || a.activeUntil > now);

// Mongo sorts null below every date, so a descending sort puts an unbounded start last.
const byNewestStart = (a: ActivationDoc, b: ActivationDoc): number =>
  (b.activeFrom?.getTime() ?? -Infinity) - (a.activeFrom?.getTime() ?? -Infinity) || a._id.localeCompare(b._id);

export class FakeMapRepository implements PublicOf<MapRepository> {
  activations: ActivationDoc[] = [];
  places: MapPlaceDoc[] = [];
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async ensureIndexes(): Promise<void> {}

  async findActiveActivation(now: Date): Promise<ActivationDoc | null> {
    if (this.failWith) throw this.failWith;
    return [...this.activations].filter((a) => isOpenAt(a, now)).sort(byNewestStart)[0] ?? null;
  }

  async listPlacesByLayerSetId(layerSetId: string): Promise<MapPlaceDoc[]> {
    if (this.failWith) throw this.failWith;
    return this.places.filter((p) => p.layerSetId === layerSetId);
  }

  async listPlacesWithDetailByLayerSetId(layerSetId: string): Promise<MapPlaceDoc[]> {
    if (this.failWith) throw this.failWith;
    return this.places.filter((p) => p.layerSetId === layerSetId && p.detail != null);
  }
}
