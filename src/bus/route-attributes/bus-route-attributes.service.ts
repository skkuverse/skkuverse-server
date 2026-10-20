import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import logger from "../../infra/logger";
import { JONGRO_ROUTES } from "../bus.constants";
import type { JongroRouteAttributes } from "../bus.types";
import { ROUTE_ATTRIBUTES_LOG_INTERVAL_MS } from "./bus-route-attributes.constants";
import type { StoredRouteAttributes } from "./bus-route-attributes.document";
import { BusRouteAttributesReadError, BusRouteAttributesUnavailableError } from "./bus-route-attributes.error";
import { BusRouteAttributesRepository } from "./bus-route-attributes.repository";
import { toMissingRouteIds, toUnknownRouteIds } from "./bus-route-attributes.rules";
import type { RouteAttributesSnapshot } from "./bus-route-attributes.types";

// SEE: docs/explanation/bus-architecture.md ("Invariants"): the attributes join where they are served, never in the registry.
@Injectable()
export class BusRouteAttributesService {
  // WHY: a reload every TTL re-finds the same gap; it is logged once per revision this process loads.
  private loggedRevision: number | null = null;
  private readonly loader: DatasetLoader<RouteAttributesSnapshot>;

  constructor(
    private readonly repository: BusRouteAttributesRepository,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "bus.route_attributes",
      load: () => this.loadSnapshot(),
      clock,
      isReadError: (err): err is BusRouteAttributesReadError => err instanceof BusRouteAttributesReadError,
      toUnavailable: () => new BusRouteAttributesUnavailableError(),
      readFailedEvent: "bus.route_attributes.read_failed",
      logIntervalMs: ROUTE_ATTRIBUTES_LOG_INTERVAL_MS,
    });
  }

  current(): Promise<RouteAttributesSnapshot> {
    return this.loader.get();
  }

  // WHY: for a reader that serves the other groups without the Jongro routes; the loader and repository log the cause at error.
  async findCurrent(): Promise<RouteAttributesSnapshot | null> {
    try {
      return await this.loader.get();
    } catch (err) {
      if (err instanceof BusRouteAttributesUnavailableError) return null;
      throw err;
    }
  }

  // WHY: for a reader of one route: a route the revision lacks answers the same 503 as attributes never read.
  async attributesOf(routeId: string): Promise<JongroRouteAttributes> {
    const attributes = (await this.loader.get()).attributesOf(routeId);
    if (attributes === undefined) throw new BusRouteAttributesUnavailableError();
    return attributes;
  }

  private async loadSnapshot(): Promise<RouteAttributesSnapshot | null> {
    const stored = await this.repository.findAttributes();
    if (stored === null) return null;
    this.logGaps(stored);
    const { revision, data } = stored;
    const servedIds = new Set(JONGRO_ROUTES.map((route) => route.id));
    return { revision, attributesOf: (routeId) => (servedIds.has(routeId) && Object.hasOwn(data.routes, routeId) ? data.routes[routeId] : undefined) };
  }

  private logGaps({ revision, data }: StoredRouteAttributes): void {
    if (revision === this.loggedRevision) return;
    this.loggedRevision = revision;
    const routeIds = JONGRO_ROUTES.map((route) => route.id);
    for (const routeId of toMissingRouteIds(data, routeIds)) {
      logger.error({ event: "bus.route_attributes.route_missing", revision, routeId }, "A Jongro route the code serves has no stored attributes; not served");
    }
    for (const routeId of toUnknownRouteIds(data, routeIds)) {
      logger.warn({ event: "bus.route_attributes.route_unknown", revision, routeId }, "Stored attributes name a Jongro route the code does not serve; ignored");
    }
  }
}
