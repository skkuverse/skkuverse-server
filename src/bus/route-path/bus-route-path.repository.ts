import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { mongoCollection } from "../../infra/mongo";
import type { JongroRoutePathDocument } from "./bus-route-path.document";

const ROUTE_PATH_PROJECTION = { busRouteId: 1, path: 1, stations: 1, pathVersion: 1, syncedAt: 1 } as const;

@Injectable()
export class BusRoutePathRepository {
  // WHY: $setOnInsert on the route id, so a first sync never overwrites a line another writer stored first.
  async insertRoutePath({ _id, ...routePath }: JongroRoutePathDocument): Promise<boolean> {
    const result = await this.routePaths().updateOne({ _id }, { $setOnInsert: routePath }, { upsert: true });
    return result.upsertedCount === 1;
  }

  // WHY: three documents, written only by this module, so the read is typed, not parsed.
  async listRoutePaths(): Promise<JongroRoutePathDocument[]> {
    return this.routePaths().find({}, { projection: ROUTE_PATH_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS }).toArray();
  }

  // WHY: guarded by the version the caller read, so a sync never overwrites an operator's edit made since.
  async updateRoutePath(fromVersion: string, { _id, ...routePath }: JongroRoutePathDocument): Promise<boolean> {
    const result = await this.routePaths().updateOne({ _id, pathVersion: fromVersion }, { $set: routePath });
    return result.matchedCount === 1;
  }

  private routePaths(): Collection<JongroRoutePathDocument> {
    return mongoCollection<JongroRoutePathDocument>(config.mongo.dbName, config.mongo.collections.jongroRoutePaths);
  }
}
