import { Injectable } from "@nestjs/common";
import type { CampusShapeDoc } from "../../building/building.document";
import { BuildingService } from "../../building/building.service";
import { createLogThrottle } from "../../infra/log-throttle";
import logger from "../../infra/logger";
import type { MapOverlay } from "../map.wire";
import { SHAPES_SKIPPED_LOG_INTERVAL_MS } from "./map-campus.constants";
import { toCampusBuildingOverlays, toFallbackOverlays, toShapeOverlay } from "./map-campus.mapper";
import { shapeSkipReason } from "./map-campus.rules";
import type { CampusOverlays } from "./map-campus.types";

@Injectable()
export class MapCampusService {
  private readonly skippedThrottle = createLogThrottle(SHAPES_SKIPPED_LOG_INTERVAL_MS);

  constructor(private readonly buildings: BuildingService) {}

  // WHY: the two reads run together, and a shapes failure leaves the buildings: geometry is an enhancement.
  async getCampusOverlays(): Promise<CampusOverlays> {
    const [buildings, shapes] = await Promise.all([this.buildingOverlays(), this.shapeOverlays()]);
    return { overlays: [...buildings.overlays, ...shapes], degraded: buildings.degraded };
  }

  private async buildingOverlays(): Promise<CampusOverlays> {
    const buildings = await this.buildings.listAllBuildings();
    if (buildings.length === 0) return { overlays: toFallbackOverlays(), degraded: true };
    return { overlays: toCampusBuildingOverlays(buildings), degraded: false };
  }

  // WHY: the catch covers the projection too, so a throw inside it cannot take the buildings with it.
  private async shapeOverlays(): Promise<MapOverlay[]> {
    try {
      return this.toDrawableShapes(await this.buildings.listAllCampusShapes());
    } catch (err) {
      logger.warn({ event: "map.campus.shapes_failed", err }, "Campus shapes failed; serving buildings only");
      return [];
    }
  }

  private toDrawableShapes(docs: readonly CampusShapeDoc[]): MapOverlay[] {
    const skipped = docs.map(shapeSkipReason).filter((reason): reason is string => reason !== null);
    const ticket = skipped.length > 0 ? this.skippedThrottle.take(skipped.join("|")) : null;
    if (ticket) {
      logger.warn(
        { event: "map.campus.shapes_skipped", count: skipped.length, skipped, suppressed: ticket.suppressed },
        "Campus shapes skipped",
      );
    }
    return docs.filter((doc) => shapeSkipReason(doc) === null).map(toShapeOverlay);
  }
}
