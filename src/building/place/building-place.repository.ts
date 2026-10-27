import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { createCachedLoader } from "../../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import logger from "../../infra/logger";
import { mongoCollection } from "../../infra/mongo";
import { isRecord } from "../../shared/object.util";
import { parseEach } from "../../shared/zod-list.util";
import type { SpaceDoc } from "../building.document";
import { BUILDING_CACHE_TTL_MS } from "../building.constants";
import type { PlaceSpace } from "./building-place.document";
import { placeSpace } from "./building-place.schema";

const MAX_LOGGED_INVALID_SPACES = 10;

const PLACE_SPACE_FIELDS = { _id: 0, spaceCd: 1, buildNo: 1, campus: 1, buildingName: 1 } as const;

// WHY: the sort follows the spaces' unique index (spaceCd, buildNo, campus), which the writer creates, so the whole
// read needs no in-memory sort.
@Injectable()
export class BuildingPlaceRepository {
  private readonly spacesCache = createCachedLoader({
    name: "place spaces",
    ttlMs: BUILDING_CACHE_TTL_MS,
    load: async (): Promise<PlaceSpace[]> => {
      const { valid: spaces, invalid } = parseEach(
        await this.spaces()
          .find({ spaceCd: { $ne: null } }, { projection: PLACE_SPACE_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
          .sort({ spaceCd: 1, buildNo: 1, campus: 1 })
          .toArray(),
        placeSpace,
        (doc, index) => (isRecord(doc) && typeof doc.spaceCd === "string" ? doc.spaceCd : `#${index}`),
      );
      if (invalid.length > 0) {
        const logged = invalid.slice(0, MAX_LOGGED_INVALID_SPACES);
        logger.warn({ event: "building.spaces.invalid", count: invalid.length, invalid: logged }, "Spaces left out: they do not match the document schema");
      }
      return spaces;
    },
  });

  listSpaces(): Promise<readonly PlaceSpace[]> {
    return this.spacesCache.get();
  }

  private spaces(): Collection<SpaceDoc> {
    return mongoCollection<SpaceDoc>(config.building.dbName, config.building.collections.spaces);
  }
}
