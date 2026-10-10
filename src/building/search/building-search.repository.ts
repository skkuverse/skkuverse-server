import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { mongoCollection } from "../../infra/mongo";
import type { BuildingDoc, SpaceDoc } from "../building.document";
import type { Campus } from "../building.types";
import { BUILDING_SEARCH, SPACE_SEARCH, rankedSearchPipeline, toRankedResult } from "./building-search.query";
import type { RankedFacet, RankedSearchResult } from "./building-search.types";

/** A full scan of spaces, ~20 ms measured, so it gets more room than a hot point read. */
const SEARCH_MAX_TIME_MS = 5000;

// Deliberately no index: the $or has unindexed branches, so Mongo scans anyway.
// Why, and what to do if spaces grows: ADR 0006, Consequences.
@Injectable()
export class BuildingSearchRepository {
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
    return mongoCollection<BuildingDoc>(config.building.dbName, config.building.collections.buildings);
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName, config.building.collections.spaces);
  }
}
