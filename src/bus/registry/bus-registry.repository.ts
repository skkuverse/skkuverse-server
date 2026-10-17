import { Injectable } from "@nestjs/common";
import type { Collection } from "mongodb";
import config from "../../infra/config";
import { HOT_READ_MAX_TIME_MS } from "../../infra/db";
import { mongoCollection } from "../../infra/mongo";
import type { JongroRouteDocument } from "./bus-registry.document";
import { jongroRouteDocument } from "./bus-registry.schema";

type StoredRoute = Omit<JongroRouteDocument, "_id">;

const ROUTE_PROJECTION = { stations: 1, turnaroundTopisId: 1, stationsVersion: 1, syncedAt: 1 } as const;

@Injectable()
export class BusRegistryRepository {
  // WHY: $setOnInsert on the route id, so a seed never overwrites a stored list, however old the snapshot.
  async insertRoute({ _id, ...route }: JongroRouteDocument): Promise<boolean> {
    const result = await this.routes().updateOne({ _id }, { $setOnInsert: route }, { upsert: true });
    return result.upsertedCount === 1;
  }

  // WHY: parsed, since the how-to has an operator write this document by hand.
  async findRoute(routeId: string): Promise<JongroRouteDocument | null> {
    const doc = await this.routes().findOne({ _id: routeId }, { projection: ROUTE_PROJECTION, maxTimeMS: HOT_READ_MAX_TIME_MS });
    return doc === null ? null : jongroRouteDocument.parse(doc);
  }

  // WHY: guarded by the version the caller read, so two writers never clobber each other.
  async updateStations(routeId: string, fromVersion: string, route: StoredRoute): Promise<boolean> {
    const result = await this.routes().updateOne({ _id: routeId, stationsVersion: fromVersion }, { $set: route });
    return result.matchedCount === 1;
  }

  private routes(): Collection<JongroRouteDocument> {
    return mongoCollection<JongroRouteDocument>(config.mongo.dbName, config.mongo.collections.jongroRoutes);
  }
}
