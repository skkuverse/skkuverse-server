/**
 * In-memory BuildingCafeteriaListRepository over `facilities`, with the real
 * read's filter (cafeterias of the campus), projection and conspaceCd sort,
 * pinned in building-cafeteria-list.repository.spec.ts. `failWith` makes the
 * read reject, as a database error would.
 */
import type { Campus } from "../../../../src/building/building.types";
import type { CafeteriaDoc } from "../../../../src/building/cafeteria/building-cafeteria.document";
import type { ListedCafeteria } from "../../../../src/building/cafeteria-list/building-cafeteria-list.document";
import type { BuildingCafeteriaListRepository } from "../../../../src/building/cafeteria-list/building-cafeteria-list.repository";
import type { PublicOf } from "../public-of";

export class FakeBuildingCafeteriaListRepository implements PublicOf<BuildingCafeteriaListRepository> {
  cafeterias: CafeteriaDoc[] = [];
  failWith: Error | null = null;

  async listCafeterias(campus: Campus): Promise<readonly ListedCafeteria[]> {
    if (this.failWith) throw this.failWith;
    return [...this.cafeterias]
      .filter((c) => c.kind === "cafeteria" && c.campus === campus)
      .sort((a, b) => a._id.localeCompare(b._id))
      .map(({ _id, campus: cafeteriaCampus, name, buildNo, floor, spaceCd, location }) => ({
        _id,
        campus: cafeteriaCampus,
        name,
        buildNo,
        floor,
        spaceCd,
        location,
      }));
  }
}
