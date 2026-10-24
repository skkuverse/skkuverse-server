/**
 * In-memory BuildingPlaceRepository over `spaces`, with the real read's filter
 * (a spaceCd is set), projection, spaceCd, buildNo, campus sort and parse,
 * pinned in building-place.repository.spec.ts: a space `placeSpace` rejects is
 * left out. The read returns the same array until
 * `spaces` is replaced, as the cached read does within its TTL. `failWith`
 * makes the read reject, as a database error would.
 */
import type { SpaceDoc } from "../../../../src/building/building.document";
import type { PlaceSpace } from "../../../../src/building/place/building-place.document";
import type { BuildingPlaceRepository } from "../../../../src/building/place/building-place.repository";
import { placeSpace } from "../../../../src/building/place/building-place.schema";
import type { PublicOf } from "../public-of";

export class FakeBuildingPlaceRepository implements PublicOf<BuildingPlaceRepository> {
  spaces: SpaceDoc[] = [];
  failWith: Error | null = null;
  private read: { from: SpaceDoc[]; spaces: PlaceSpace[] } | null = null;

  async listSpaces(): Promise<readonly PlaceSpace[]> {
    if (this.failWith) throw this.failWith;
    if (this.read?.from !== this.spaces) this.read = { from: this.spaces, spaces: this.project() };
    return this.read.spaces;
  }

  private project(): PlaceSpace[] {
    const order = (s: SpaceDoc) => `${s.spaceCd}\u0000${s.buildNo}\u0000${s.campus}`;
    return [...this.spaces]
      .filter((s) => s.spaceCd !== null)
      .sort((a, b) => (order(a) < order(b) ? -1 : 1))
      .flatMap((space) => {
        const parsed = placeSpace.safeParse(space);
        return parsed.success ? [parsed.data] : [];
      });
  }
}
