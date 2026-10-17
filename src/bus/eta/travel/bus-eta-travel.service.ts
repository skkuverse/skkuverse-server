import { Injectable } from "@nestjs/common";
import config from "../../../infra/config";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { EtaRun } from "../bus-eta.types";
import { BusEtaLaneService } from "../lane/bus-eta-lane.service";
import type { LaneDirection, SequenceKey, SequenceStrategy } from "../lane/bus-eta-lane.types";
import { BusEtaProbeService } from "../probe/bus-eta-probe.service";
import type { LegTime } from "../probe/bus-eta-probe.types";
import { BusEtaTravelClient } from "./bus-eta-travel.client";
import { toCorridorRoute, toCorridorRoutePoints } from "./bus-eta-travel.rules";
import type { CorridorRoute, NaverCredentials } from "./bus-eta-travel.types";

/** WHY: the live flow's door to the travel model: a run's strategy, the NAVER routes per model and the probe's corridor time. */
@Injectable()
export class BusEtaTravelService {
  constructor(
    private readonly lane: BusEtaLaneService,
    private readonly probe: BusEtaProbeService,
    private readonly client: BusEtaTravelClient,
  ) {}

  strategyOfRun(run: SequenceKey & Pick<EtaRun, "time">): SequenceStrategy {
    return this.lane.strategyOfRun(run);
  }

  fetchOffsets(stops: readonly LatLng[]): Promise<number[]> {
    return this.client.fetchOffsets(stops, this.credentials());
  }

  async fetchCorridorRoute(stops: readonly LatLng[], direction: LaneDirection): Promise<CorridorRoute> {
    const points = toCorridorRoutePoints(stops, this.lane.corridorEndsOf(direction));
    return toCorridorRoute(await this.client.fetchRouteTimes(points, this.credentials()));
  }

  legTime(direction: LaneDirection, now: Date): Promise<LegTime> {
    return this.probe.legTime(direction, now);
  }

  prime(now: Date): Promise<void> {
    return this.probe.prime(now);
  }

  // WHY: config.ts exits at boot without the keys while SHUTTLE_ETA is on, the only state in which a call is made.
  private credentials(): NaverCredentials {
    const { naver } = config.shuttleEta;
    return { keyId: naver.keyId as string, key: naver.key as string };
  }
}
