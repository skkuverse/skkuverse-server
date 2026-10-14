/**
 * In-memory MapRepository: activations and places, with the real reads'
 * filters and sort, which src/map/map.repository.spec.ts pins (each read
 * there, by the repository-pins architecture test), and the same parse:
 * a place that is not renderable is left out, and an activation that does not
 * parse reads as none. Like the real projections, a place read carries only
 * the fields its route reads (map.query.ts, the projections the real reads pass)
 * and an activation only `_id` and `activeUntil`.
 * `failWith` makes the next reads reject, as a database error would.
 */
import type { ActivationDoc, LiveActivation, MapPlaceDoc, OverlayPlaceDoc, SheetPlaceDoc } from "../../../../src/map/map.document";
import { OVERLAY_PLACE_FIELDS, SHEET_PLACE_FIELDS } from "../../../../src/map/map.query";
import type { MapRepository } from "../../../../src/map/map.repository";
import { liveActivation, overlayPlaceDoc, sheetPlaceDoc } from "../../../../src/map/map.schema";
import type { PublicOf } from "../public-of";

const isOpenAt = (a: ActivationDoc, now: Date): boolean =>
  a.enabled && (a.activeFrom == null || a.activeFrom <= now) && (a.activeUntil == null || a.activeUntil > now);

// Mongo sorts null below every date, so a descending sort puts an unbounded start last.
const byNewestStart = (a: ActivationDoc, b: ActivationDoc): number =>
  (b.activeFrom?.getTime() ?? -Infinity) - (a.activeFrom?.getTime() ?? -Infinity) || a._id.localeCompare(b._id);

const OVERLAY_FIELDS = Object.keys(OVERLAY_PLACE_FIELDS);
const SHEET_FIELDS = Object.keys(SHEET_PLACE_FIELDS);

/** An inclusion projection: only the listed fields that the document has. */
const projected = (doc: MapPlaceDoc, fields: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(fields.filter((f) => Object.hasOwn(doc, f)).map((f) => [f, (doc as unknown as Record<string, unknown>)[f]]));

export class FakeMapRepository implements PublicOf<MapRepository> {
  activations: ActivationDoc[] = [];
  places: MapPlaceDoc[] = [];
  failWith: Error | null = null;

  async onModuleInit(): Promise<void> {}

  async ensureIndexes(): Promise<void> {}

  async findActiveActivation(now: Date): Promise<LiveActivation | null> {
    if (this.failWith) throw this.failWith;
    const activation = [...this.activations].filter((a) => isOpenAt(a, now)).sort(byNewestStart)[0];
    if (!activation) return null;
    const parsed = liveActivation.safeParse({ _id: activation._id, activeUntil: activation.activeUntil });
    return parsed.success ? parsed.data : null;
  }

  async listPlacesByLayerSetId(layerSetId: string): Promise<OverlayPlaceDoc[]> {
    if (this.failWith) throw this.failWith;
    return this.places
      .filter((p) => p.layerSetId === layerSetId)
      .flatMap((p) => {
        const parsed = overlayPlaceDoc.safeParse(projected(p, OVERLAY_FIELDS));
        return parsed.success ? [parsed.data] : [];
      });
  }

  async listPlacesWithDetailByLayerSetId(layerSetId: string): Promise<SheetPlaceDoc[]> {
    if (this.failWith) throw this.failWith;
    return this.places
      .filter((p) => p.layerSetId === layerSetId && p.detail != null)
      .flatMap((p) => {
        const parsed = sheetPlaceDoc.safeParse(projected(p, SHEET_FIELDS));
        return parsed.success ? [parsed.data] : [];
      });
  }
}
