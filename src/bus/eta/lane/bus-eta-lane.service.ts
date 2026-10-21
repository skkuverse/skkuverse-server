import { Injectable } from "@nestjs/common";
import { Clock } from "../../../infra/clock";
import { createDatasetLoader, type DatasetLoader } from "../../../infra/dataset-loader";
import logger from "../../../infra/logger";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun, EtaSequence } from "../bus-eta.types";
import { BUS_LANE_CORRIDOR_LOG_INTERVAL_MS, LANE_HOURS, LANE_STRATEGIES } from "./bus-eta-lane.constants";
import { BusEtaLaneUnavailableError } from "../bus-eta.error";
import { BusEtaLaneReadError } from "./bus-eta-lane.error";
import { toCorridorSnapshot } from "./bus-eta-lane.mapper";
import { BusEtaLaneRepository } from "./bus-eta-lane.repository";
import { assertLaneStrategies, strategyOfRun } from "./bus-eta-lane.rules";
import type { LaneCorridorSnapshot, SequenceKey, SequenceStrategy } from "./bus-eta-lane.types";

/** WHY: the strategies and lane hours are checked against each bus-stops revision's estimated sequences, which a push checks first. */
@Injectable()
export class BusEtaLaneService {
  private readonly corridorLoader: DatasetLoader<LaneCorridorSnapshot>;
  // WHY: the sequences of one revision, checked once, and the error each tick of that revision rejects with.
  private checked: { sequences: readonly EtaSequence[]; error: Error | null } | null = null;

  constructor(
    private readonly eta: BusEtaService,
    repository: BusEtaLaneRepository,
    clock: Clock,
  ) {
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

  // WHY: the estimated sequences a tick runs over; a revision the strategies do not fit rejects every tick, logged once.
  async sequences(): Promise<readonly EtaSequence[]> {
    const sequences = await this.eta.sequences();
    if (this.checked?.sequences !== sequences) this.checked = { sequences, error: this.strategyError(sequences) };
    if (this.checked.error) throw this.checked.error;
    return sequences;
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

  private strategyError(sequences: readonly EtaSequence[]): Error | null {
    try {
      assertLaneStrategies(LANE_STRATEGIES, sequences);
      return null;
    } catch (err: unknown) {
      logger.error({ event: "bus.eta.lane_strategy_unmatched", err }, "The lane strategies name a sequence this bus-stops revision does not estimate");
      return err instanceof Error ? err : new Error(String(err));
    }
  }
}
