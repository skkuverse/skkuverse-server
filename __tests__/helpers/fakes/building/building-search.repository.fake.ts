/**
 * BuildingSearchRepository with seeded ranked results. Ranking and keyword
 * matching are MongoDB's ($facet over the score in building-search.query.ts),
 * so a test seeds the rows in rank order. The fake applies the one rule the
 * real pipeline does in the facet: a campus filter narrows the rows and their
 * total, while the per-campus counts stay campus-agnostic. `searches` records
 * each call's keyword and campus.
 */
import type { BuildingDoc, SpaceDoc } from "../../../../src/building/building.document";
import type { Campus } from "../../../../src/building/building.types";
import type { BuildingSearchRepository } from "../../../../src/building/search/building-search.repository";
import type { RankedSearchResult } from "../../../../src/building/search/building-search.types";
import type { PublicOf } from "../public-of";

/** Rows in rank order. `total` and `truncated` stand for a match set larger than the rows returned. */
type Seeded<T> = { items: T[]; counts?: RankedSearchResult<T>["counts"]; total?: number; truncated?: boolean };

function ranked<T extends { campus: Campus }>(seeded: Seeded<T>, campus: Campus | undefined): RankedSearchResult<T> {
  const items = campus ? seeded.items.filter((item) => item.campus === campus) : seeded.items;
  const hssc = seeded.items.filter((item) => item.campus === "hssc").length;
  const nsc = seeded.items.length - hssc;
  return {
    items,
    counts: seeded.counts ?? { hssc, nsc, total: hssc + nsc },
    total: seeded.total ?? items.length,
    truncated: seeded.truncated ?? false,
  };
}

export class FakeBuildingSearchRepository implements PublicOf<BuildingSearchRepository> {
  buildings: Seeded<BuildingDoc> = { items: [] };
  spaces: Seeded<SpaceDoc> = { items: [] };
  searches: Array<{ collection: "buildings" | "spaces"; keyword: string; campus: Campus | undefined }> = [];

  async searchBuildings(keyword: string, campus?: Campus): Promise<RankedSearchResult<BuildingDoc>> {
    this.searches.push({ collection: "buildings", keyword, campus });
    return ranked(this.buildings, campus);
  }

  async searchSpaces(keyword: string, campus?: Campus): Promise<RankedSearchResult<SpaceDoc>> {
    this.searches.push({ collection: "spaces", keyword, campus });
    return ranked(this.spaces, campus);
  }
}
