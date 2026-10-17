import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { createCachedLoader } from "../../infra/cached-loader";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { mongoCollection } from "../../infra/mongo";
import { BUILDING_CACHE_TTL_MS } from "../building.constants";
import type { Campus } from "../building.types";
import type { CafeteriaDoc } from "../cafeteria/building-cafeteria.document";
import type { ListedCafeteria } from "./building-cafeteria-list.document";

const LISTED_CAFETERIA_FIELDS = { _id: 1, campus: 1, name: 1, buildNo: 1, floor: 1, spaceCd: 1, location: 1 } as const;

// WHY: a handful of documents, read whole and filtered in memory, so no index serves the read.
@Injectable()
export class BuildingCafeteriaListRepository {
  private readonly cafeteriasCache = createCachedLoader({
    name: "cafeterias",
    ttlMs: BUILDING_CACHE_TTL_MS,
    load: (): Promise<ListedCafeteria[]> =>
      this.facilities()
        .find({ kind: "cafeteria" }, { projection: LISTED_CAFETERIA_FIELDS, maxTimeMS: HOT_READ_MAX_TIME_MS })
        .sort({ _id: 1 })
        .toArray(),
  });

  async listCafeterias(campus: Campus): Promise<readonly ListedCafeteria[]> {
    const cafeterias = await this.cafeteriasCache.get();
    return cafeterias.filter((c) => c.campus === campus);
  }

  private facilities(): Collection<CafeteriaDoc> {
    return mongoCollection<CafeteriaDoc>(config.building.dbName, config.building.collections.facilities);
  }
}
