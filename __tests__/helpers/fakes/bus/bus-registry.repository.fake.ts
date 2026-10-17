/**
 * In-memory BusRegistryRepository: one document per route id, kept as the
 * real writes keep them (insertRoute never overwrites, updateStations writes
 * only where the stored version is the one read; both pinned in
 * bus-registry.repository.spec.ts). Reads return a copy. `failWith` makes
 * every call reject.
 */
import type { JongroRouteDocument } from "../../../../src/bus/registry/bus-registry.document";
import type { BusRegistryRepository } from "../../../../src/bus/registry/bus-registry.repository";
import type { PublicOf } from "../public-of";

export class FakeBusRegistryRepository implements PublicOf<BusRegistryRepository> {
  routes = new Map<string, JongroRouteDocument>();
  failWith: Error | null = null;

  async insertRoute(doc: JongroRouteDocument): Promise<boolean> {
    this.fail();
    if (this.routes.has(doc._id)) return false;
    this.routes.set(doc._id, structuredClone(doc));
    return true;
  }

  async findRoute(routeId: string): Promise<JongroRouteDocument | null> {
    this.fail();
    const doc = this.routes.get(routeId);
    return doc === undefined ? null : structuredClone(doc);
  }

  async updateStations(routeId: string, fromVersion: string, route: Omit<JongroRouteDocument, "_id">): Promise<boolean> {
    this.fail();
    const doc = this.routes.get(routeId);
    if (doc === undefined || doc.stationsVersion !== fromVersion) return false;
    this.routes.set(routeId, { ...structuredClone(route), _id: routeId });
    return true;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
