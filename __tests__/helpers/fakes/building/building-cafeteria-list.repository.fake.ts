/**
 * In-memory BuildingCafeteriaListRepository over `facilities`, with the real
 * read's filter (cafeterias of the campus), projection, conspaceCd sort and
 * parse, pinned in building-cafeteria-list.repository.spec.ts: a cafeteria the
 * schema rejects is left out. `failWith` makes the read reject, as a database
 * error would.
 */
import type { Campus } from "../../../../src/building/building.types";
import type { CafeteriaDoc } from "../../../../src/building/building.document";
import type { ListedCafeteria } from "../../../../src/building/cafeteria-list/building-cafeteria-list.document";
import type { BuildingCafeteriaListRepository } from "../../../../src/building/cafeteria-list/building-cafeteria-list.repository";
import { listedCafeteria } from "../../../../src/building/cafeteria-list/building-cafeteria-list.schema";
import type { PublicOf } from "../public-of";

export class FakeBuildingCafeteriaListRepository implements PublicOf<BuildingCafeteriaListRepository> {
  cafeterias: CafeteriaDoc[] = [];
  failWith: Error | null = null;

  async listCafeterias(campus: Campus): Promise<readonly ListedCafeteria[]> {
    if (this.failWith) throw this.failWith;
    return [...this.cafeterias]
      .filter((c) => c.kind === "cafeteria" && c.campus === campus)
      .sort((a, b) => a._id.localeCompare(b._id))
      .flatMap((cafeteria) => {
        const parsed = listedCafeteria.safeParse(cafeteria);
        return parsed.success ? [parsed.data] : [];
      });
  }
}
