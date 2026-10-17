import { Injectable } from "@nestjs/common";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun } from "../bus-eta.types";
import { readLaneConfig } from "./bus-eta-lane.config";
import { strategyOfRun, toLegBounds } from "./bus-eta-lane.rules";
import type { CorridorEnds, LaneConfig, LaneCorridor, LaneDirection, LegBounds, ProbeRoute, SequenceKey, SequenceStrategy } from "./bus-eta-lane.types";

/** WHY: bus-lane.json is read at construction and checked against the estimated sequences, so a bad one fails the boot. */
@Injectable()
export class BusEtaLaneService {
  private readonly lane: Readonly<LaneConfig>;

  constructor(eta: BusEtaService) {
    this.lane = readLaneConfig(eta.sequences());
  }

  strategyOfRun(run: SequenceKey & Pick<EtaRun, "time">): SequenceStrategy {
    return strategyOfRun(this.lane, run);
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
