import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import type { Campus } from "../building.types";
import { BUILDING_SEARCH, SPACE_SEARCH, rankedSearchPipeline, toRankedResult } from "./building-search.query";
import type { RankedFacet, RankedSearchResult } from "./building-search.types";

/**
 * Search scans every space (no index can serve it, see the class comment),
 * ~20 ms measured, so it gets more room than a hot point read.
 */
const SEARCH_MAX_TIME_MS = 5000;

/**
 * Ranked search over buildings and rooms.
 *
 * There is deliberately no index for it, and adding one would be cost without
 * effect. A $or uses index-union only if EVERY branch is indexed; the search
 * predicate ORs over name.ko / name.en / buildingName.* which are not, so the
 * whole thing plans as SUBPLAN -> COLLSCAN and the spaceCd branch never gets
 * its own IXSCAN. $options:"i" would disable prefix-anchoring anyway. Measured: ~20ms over 7691 spaces,
 * and the endpoint went from six collection scans to two when rows and counts
 * merged into one $facet. spaces is ~2.5MB and fully cached.
 *
 * If spaces ever grows ~10x, the fix is Atlas Search (autocomplete/edgeGram
 * mapping on spaceCd), not a classic index. Watch the $facet ceiling too: each
 * facet stage is capped at 100MB and CANNOT spill to disk (allowDiskUse does
 * not apply), and the emitted document is bound by the 16MB BSON limit.
 */
@Injectable()
export class BuildingSearchRepository {
  /**
   * Ranked search. Rows and per-campus counts arrive together from one $facet,
   * so the count can never describe a different predicate than the list.
   */
  async searchBuildings(
    keyword: string,
    campus?: Campus | null,
  ): Promise<RankedSearchResult<BuildingDoc>> {
    const facets = await this.buildings()
      .aggregate<RankedFacet<BuildingDoc>>(rankedSearchPipeline(BUILDING_SEARCH, keyword, campus), {
        maxTimeMS: SEARCH_MAX_TIME_MS,
      })
      .toArray();
    return toRankedResult(facets);
  }

  async searchSpaces(
    keyword: string,
    campus?: Campus | null,
  ): Promise<RankedSearchResult<SpaceDoc>> {
    const facets = await this.spaces()
      .aggregate<RankedFacet<SpaceDoc>>(rankedSearchPipeline(SPACE_SEARCH, keyword, campus), {
        maxTimeMS: SEARCH_MAX_TIME_MS,
      })
      .toArray();
    return toRankedResult(facets);
  }

  private buildings(): Collection<BuildingDoc> {
    return mongoCollection<BuildingDoc>(config.building.dbName!, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName!, config.building.collections.spaces);
  }
}
