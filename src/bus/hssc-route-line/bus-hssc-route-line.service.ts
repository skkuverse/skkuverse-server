import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../infra/dataset-loader";
import { HSSC_ROUTE_LINE_LOG_INTERVAL_MS } from "./bus-hssc-route-line.constants";
import { BusHsscRouteLineReadError, BusHsscRouteLineUnavailableError } from "./bus-hssc-route-line.error";
import { BusHsscRouteLineRepository } from "./bus-hssc-route-line.repository";
import type { HsscRouteLine } from "./bus-hssc-route-line.types";

@Injectable()
export class BusHsscRouteLineService {
  private readonly loader: DatasetLoader<HsscRouteLine>;

  constructor(
    private readonly repository: BusHsscRouteLineRepository,
    clock: Clock,
  ) {
    this.loader = createDatasetLoader({
      name: "bus.hssc_route_line",
      load: async () => {
        const stored = await this.repository.findRouteLine();
        return stored && { revision: stored.revision, path: stored.data.path };
      },
      clock,
      isReadError: (err): err is BusHsscRouteLineReadError => err instanceof BusHsscRouteLineReadError,
      toUnavailable: () => new BusHsscRouteLineUnavailableError(),
      readFailedEvent: "bus.hssc_route_line.read_failed",
      logIntervalMs: HSSC_ROUTE_LINE_LOG_INTERVAL_MS,
    });
  }

  // WHY: the map serves the Jongno lines without this one; the repository and the loader log the cause at error.
  async findCurrent(): Promise<HsscRouteLine | null> {
    try {
      return await this.loader.get();
    } catch (err) {
      if (err instanceof BusHsscRouteLineUnavailableError) return null;
      throw err;
    }
  }
}
