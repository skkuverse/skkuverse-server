import { Injectable } from "@nestjs/common";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun } from "../bus-eta.types";
import { readLaneConfig } from "./bus-eta-lane.config";
import { LANE_HOURS, LANE_STRATEGIES } from "./bus-eta-lane.constants";
import { assertLaneStrategies, strategyOfRun, toLegBounds } from "./bus-eta-lane.rules";
import type { CorridorEnds, LaneConfig, LaneCorridor, LaneDirection, LegBounds, ProbeRoute, SequenceKey, SequenceStrategy } from "./bus-eta-lane.types";

/** WHY: the strategies and lane hours are checked against the estimated sequences at construction, so a bad one fails the boot. */
@Injectable()
export class BusEtaLaneService {
  private readonly lane: Readonly<LaneConfig>;

  constructor(eta: BusEtaService) {
    assertLaneStrategies(LANE_STRATEGIES, eta.sequences());
    this.lane = readLaneConfig(eta.sequences());
  }

  strategyOfRun(run: SequenceKey & Pick<EtaRun, "time">): SequenceStrategy {
    return strategyOfRun({ strategies: LANE_STRATEGIES, laneHours: LANE_HOURS }, run);
  }

  corridorEndsOf(direction: LaneDirection): CorridorEnds {
    return this.lane.entryExit[direction];
  }

  corridor(): LaneCorridor {
    return this.lane.corridor;
  }

  probeRoutes(): readonly ProbeRoute[] {
    return this.lane.probeRoutes;
  }

  legBoundsOf(direction: LaneDirection): LegBounds {
    return toLegBounds(this.lane.corridor, this.lane.entryExit[direction]);
  }
}
