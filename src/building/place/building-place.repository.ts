import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { createCachedLoader } from "../../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { mongoCollection } from "../../infra/mongo";
import type { SpaceDoc } from "../building.document";
import { BUILDING_CACHE_TTL_MS } from "../building.constants";
import type { PlaceSpace } from "./building-place.document";

const PLACE_SPACE_FIELDS = { _id: 0, spaceCd: 1, buildNo: 1, campus: 1, floor: 1, name: 1, buildingName: 1 } as const;

// WHY: the sort follows the spaces' unique index (spaceCd, buildNo, campus), so the whole read needs no in-memory sort.
@Injectable()
export class BuildingPlaceRepository {
  private readonly spacesCache = createCachedLoader({
    name: "place spaces",
    ttlMs: BUILDING_CACHE_TTL_MS,
    load: (): Promise<PlaceSpace[]> =>
      this.spaces()
        .find({ spaceCd: { $ne: null } }, { projection: PLACE_SPACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
        .sort({ spaceCd: 1, buildNo: 1, campus: 1 })
        .toArray(),
  });

  listSpaces(): Promise<readonly PlaceSpace[]> {
    return this.spacesCache.get();
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName, config.building.collections.spaces);
  }
}
