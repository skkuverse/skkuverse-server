import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { DailyCap } from "../../shared/daily-cap.util";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import { SubwayTopologyService } from "../topology/subway-topology.service";
import { toSeoulLines, toSeoulStations, toSettledObservations, toTrainMapLines } from "./subway-seoul.rules";
import type { PolledNetwork, SettledObservations } from "./subway-seoul.types";

const API_SOURCE = "seoul-subway-api";
const TRAIN_MAP_SOURCE = "seoul-trainmap";

// WHY: no switch here: with SUBWAY=off nothing calls the provider (its pollers do not register). Each upstream
// call takes one from its source's daily ceiling first, so a runaway loop stops at the ceiling. A tick's calls
// settle apart, so one failing line drops no other line's trains (2026-10-17 05:16, line 4's page had no train).
@Injectable()
export class SubwaySeoulService {
  private readonly apiCap = new DailyCap(API_SOURCE, config.subway.apiDailyCap);
  private readonly trainMapCap = new DailyCap(TRAIN_MAP_SOURCE, config.subway.trainMapDailyCap);
  private polled: PolledNetwork | null = null;

  constructor(
    private readonly api: SubwaySeoulApiService,
    private readonly trainMap: SubwaySeoulTrainmapService,
    private readonly clock: Clock,
    private readonly topology: SubwayTopologyService,
  ) {}

  async observeApi(): Promise<SettledObservations> {
    const { seoulLines, seoulStations } = await this.findPolledNetwork();
    const take = <T>(call: () => Promise<T>): Promise<T> => this.withCap(this.apiCap, call);
    const fetchedAt = this.clock.now();
    const [eventResults, countdownResults] = await Promise.all([
      Promise.allSettled(seoulLines.map((line) => take(() => this.api.listLineEvents(line.lineName, { platformIdByStatnId: line.platformIdByStatnId, platformIdByName: line.platformIdByApiName }, line.trainNumbers)))),
      Promise.allSettled(
        seoulStations.map((station) => take(() => this.api.listStationCountdownRows(station.seoulName, station.platformByStatnId, fetchedAt))),
      ),
    ]);
    return toSettledObservations(API_SOURCE, eventResults, countdownResults);
  }

  async observeTrainMap(): Promise<SettledObservations> {
    const { trainMapLines } = await this.findPolledNetwork();
    const observedAt = this.clock.now();
    const eventResults = await this.withCap(this.trainMapCap, () => this.trainMap.listLineEventResults(trainMapLines, observedAt));
    return toSettledObservations(TRAIN_MAP_SOURCE, eventResults, []);
  }

  // WHY: read before any call and the ceiling, so a never-read topology rejects the tick with no call made;
  // the name maps are built once per revision.
  private async findPolledNetwork(): Promise<PolledNetwork> {
    const { revision, registry } = await this.topology.current();
    if (this.polled?.revision === revision) return this.polled;
    const seoulLines = toSeoulLines(registry);
    this.polled = { revision, seoulLines, seoulStations: toSeoulStations(registry), trainMapLines: toTrainMapLines(seoulLines) };
    return this.polled;
  }

  private async withCap<T>(cap: DailyCap, call: () => Promise<T>): Promise<T> {
    cap.take(this.clock.now());
    return call();
  }
}
