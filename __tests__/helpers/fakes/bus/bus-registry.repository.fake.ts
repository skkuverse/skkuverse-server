/**
 * In-memory BusRegistryRepository: one document per route id, kept as the
 * real writes keep them (insertRoute never overwrites, updateStations sets
 * only where the stored version is the one read, updateServiceHours sets the
 * hours beside the stations; all pinned in bus-registry.repository.spec.ts).
 * Reads return a copy. `failWith` makes every call reject. `readRouteIds`
 * records the route id of every read, `serviceHoursWrites` counts hour writes.
 */
import type { JongroRouteDocument, StationServiceHours } from "../../../../src/bus/registry/bus-registry.document";
import type { BusRegistryRepository } from "../../../../src/bus/registry/bus-registry.repository";
import type { PublicOf } from "../public-of";

export class FakeBusRegistryRepository implements PublicOf<BusRegistryRepository> {
  routes = new Map<string, JongroRouteDocument>();
  failWith: Error | null = null;
  readRouteIds: string[] = [];
  serviceHoursWrites = 0;

  async insertRoute(doc: JongroRouteDocument): Promise<boolean> {
    this.fail();
    if (this.routes.has(doc._id)) return false;
    this.routes.set(doc._id, structuredClone(doc));
    return true;
  }

  async findRoute(routeId: string): Promise<JongroRouteDocument | null> {
    this.readRouteIds.push(routeId);
    this.fail();
    const doc = this.routes.get(routeId);
    return doc === undefined ? null : structuredClone(doc);
  }

  async updateStations(routeId: string, fromVersion: string, route: Omit<JongroRouteDocument, "_id">): Promise<boolean> {
    this.fail();
    const doc = this.routes.get(routeId);
    if (doc === undefined || doc.stationsVersion !== fromVersion) return false;
    this.routes.set(routeId, { ...doc, ...structuredClone(route), _id: routeId });
    return true;
  }

  async listServiceHours(routeId: string): Promise<StationServiceHours[]> {
    this.readRouteIds.push(routeId);
    this.fail();
    return structuredClone(this.routes.get(routeId)?.serviceHours ?? []);
  }

  async updateServiceHours(routeId: string, serviceHours: readonly StationServiceHours[]): Promise<void> {
    this.fail();
    const doc = this.routes.get(routeId);
    if (doc !== undefined) this.routes.set(routeId, { ...doc, serviceHours: structuredClone([...serviceHours]) });
    this.serviceHoursWrites += 1;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
