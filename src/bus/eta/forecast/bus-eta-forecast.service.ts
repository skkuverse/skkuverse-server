import { Injectable } from "@nestjs/common";
import config from "../../../infra/config";
import { toKstDate } from "../../../shared/kst-date.util";
import type { LatLng } from "../../../shared/lat-lng.types";
import type { FixedEstimate } from "../bus-eta.document";
import { BusEtaService } from "../bus-eta.service";
import type { EtaRun } from "../bus-eta.types";
import { BusEtaLaneService } from "../lane/bus-eta-lane.service";
import { BusEtaForecastClient } from "./bus-eta-forecast.client";
import { reusableFixedDates, toReusableFixedByRun } from "./bus-eta-forecast.rules";

/** WHY: the baseline flow's door to its predictions: the TMAP forecast, and a bus-lane run's last fixed value. */
@Injectable()
export class BusEtaForecastService {
  constructor(
    private readonly lane: BusEtaLaneService,
    private readonly client: BusEtaForecastClient,
    private readonly eta: BusEtaService,
  ) {}

  // WHY: config.ts exits at boot without the key while SHUTTLE_ETA is on, the only state in which a call is made.
  fetchOffsets(stops: readonly LatLng[], departAt: Date): Promise<number[]> {
    return this.client.fetchOffsets(stops, departAt, { appKey: config.shuttleEta.tmapAppKey as string });
  }

  // WHY: a car run is always forecast by TMAP; only a bus-lane run reuses a fixed value, which TMAP cannot price.
  async reusableFixedByRun(runs: readonly EtaRun[], now: Date): Promise<Map<string, FixedEstimate>> {
    const busLaneRuns = runs.filter((run) => this.lane.strategyOfRun(run).strategy === "busLane");
    if (busLaneRuns.length === 0) return new Map();
    const today = toKstDate(now);
    const serviceIds = [...new Set(busLaneRuns.map((run) => run.serviceId))];
    const dates = [...new Set(busLaneRuns.flatMap((run) => reusableFixedDates(run.date, today)))];
    return toReusableFixedByRun(busLaneRuns, await this.eta.listFixedFitting(serviceIds, dates, now), today);
  }
}
