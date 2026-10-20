import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../../infra/dataset-loader";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun } from "../bus-eta.types";
import { BUS_LANE_CORRIDOR_LOG_INTERVAL_MS, LANE_HOURS, LANE_STRATEGIES } from "./bus-eta-lane.constants";
import { BusEtaLaneUnavailableError } from "../bus-eta.error";
import { BusEtaLaneReadError } from "./bus-eta-lane.error";
import { toCorridorSnapshot } from "./bus-eta-lane.mapper";
import { BusEtaLaneRepository } from "./bus-eta-lane.repository";
import { assertLaneStrategies, strategyOfRun } from "./bus-eta-lane.rules";
import type { LaneCorridorSnapshot, SequenceKey, SequenceStrategy } from "./bus-eta-lane.types";

/** WHY: the strategies and lane hours are checked against the estimated sequences at construction, so a bad one fails the boot. */
@Injectable()
export class BusEtaLaneService {
  private readonly corridorLoader: DatasetLoader<LaneCorridorSnapshot>;

  constructor(eta: BusEtaService, repository: BusEtaLaneRepository, clock: Clock) {
    assertLaneStrategies(LANE_STRATEGIES, eta.sequences());
    this.corridorLoader = createDatasetLoader({
      name: "bus.lane_corridor",
      load: async () => {
        const stored = await repository.findCorridor();
        return stored && toCorridorSnapshot(stored);
      },
      clock,
      isReadError: (err): err is BusEtaLaneReadError => err instanceof BusEtaLaneReadError,
      toUnavailable: () => new BusEtaLaneUnavailableError(),
      readFailedEvent: "bus.lane_corridor.read_failed",
      logIntervalMs: BUS_LANE_CORRIDOR_LOG_INTERVAL_MS,
    });
  }

  strategyOfRun(run: SequenceKey & Pick<EtaRun, "time">): SequenceStrategy {
    return strategyOfRun({ strategies: LANE_STRATEGIES, laneHours: LANE_HOURS }, run);
  }

  // WHY: null with no good corridor read: the live tick then estimates bus-lane runs by car and reports failing.
  async corridor(): Promise<LaneCorridorSnapshot | null> {
    try {
      return await this.corridorLoader.get();
    } catch (err) {
      if (err instanceof BusEtaLaneUnavailableError) return null;
      throw err;
    }
  }
}
