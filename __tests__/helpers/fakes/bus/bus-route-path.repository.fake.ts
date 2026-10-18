/**
 * In-memory BusRoutePathRepository: one document per route id, kept as the
 * real writes keep them (insertRoutePath never overwrites, updateRoutePath
 * writes only where the stored version is the one read; both pinned in
 * bus-route-path.repository.spec.ts). Reads return copies in insertion order.
 * `failWith` makes every call reject.
 */
import type { JongroRoutePathDocument } from "../../../../src/bus/route-path/bus-route-path.document";
import type { BusRoutePathRepository } from "../../../../src/bus/route-path/bus-route-path.repository";
import type { PublicOf } from "../public-of";

export class FakeBusRoutePathRepository implements PublicOf<BusRoutePathRepository> {
  routePaths = new Map<string, JongroRoutePathDocument>();
  failWith: Error | null = null;
  listCount = 0;

  async insertRoutePath(doc: JongroRoutePathDocument): Promise<boolean> {
    this.fail();
    if (this.routePaths.has(doc._id)) return false;
    this.routePaths.set(doc._id, structuredClone(doc));
    return true;
  }

  async listRoutePaths(): Promise<JongroRoutePathDocument[]> {
    this.listCount += 1;
    this.fail();
    return [...this.routePaths.values()].map((doc) => structuredClone(doc));
  }

  async updateRoutePath(fromVersion: string, routePath: JongroRoutePathDocument): Promise<boolean> {
    this.fail();
    const doc = this.routePaths.get(routePath._id);
    if (doc === undefined || doc.pathVersion !== fromVersion) return false;
    this.routePaths.set(routePath._id, structuredClone(routePath));
    return true;
  }

  private fail(): void {
    if (this.failWith) throw this.failWith;
  }
}
