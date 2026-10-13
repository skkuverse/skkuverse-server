/**
 * In-memory MapRepository: activations and places, with the real reads'
 * filters and sort, which src/map/map.repository.spec.ts pins (each read
 * there, by the repository-pins architecture test), and the same parse:
 * a place that is not renderable is left out. Like the real projections, a
 * place read carries only the fields its route reads.
 * `failWith` makes the next reads reject, as a database error would.
 */
import type { ActivationDoc, MapPlaceDoc, OverlayPlaceDoc, SheetPlaceDoc } from "../../../../src/map/map.document";
import type { MapRepository } from "../../../../src/map/map.repository";
import { overlayPlaceDoc, sheetPlaceDoc } from "../../../../src/map/map.schema";
import type { PublicOf } from "../public-of";

const isOpenAt = (a: ActivationDoc, now: Date): boolean =>
  a.enabled && (a.activeFrom == null || a.activeFrom <= now) && (a.activeUntil == null || a.activeUntil > now);

// Mongo sorts null below every date, so a descending sort puts an unbounded start last.
const byNewestStart = (a: ActivationDoc, b: ActivationDoc): number =>
  (b.activeFrom?.getTime() ?? -Infinity) - (a.activeFrom?.getTime() ?? -Infinity) || a._id.localeCompare(b._id);

const OVERLAY_FIELDS = ["_id", "campus", "category", "location", "title", "subtitle", "hours", "fields", "actions", "order", "facets", "orderByOption"];
const SHEET_FIELDS = ["_id", "category", "location", "title", "hours", "fields", "actions", "detail"];

/** An inclusion projection: only the listed fields that the document has. */
const projected = (doc: MapPlaceDoc, fields: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(fields.filter((f) => Object.hasOwn(doc, f)).map((f) => [f, (doc as unknown as Record<string, unknown>)[f]]));

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
