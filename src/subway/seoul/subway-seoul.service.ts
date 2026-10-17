import { Injectable } from "@nestjs/common";
import { Clock } from "../../infra/clock";
import config from "../../infra/config";
import { DailyCap } from "../../shared/daily-cap.util";
import { SubwaySeoulApiService } from "../seoul-api/subway-seoul-api.service";
import { SubwaySeoulTrainmapService } from "../seoul-trainmap/subway-seoul-trainmap.service";
import { SUBWAY_REGISTRY } from "../subway.config";
import { toSeoulLines, toSeoulStations, toSettledObservations, toTrainMapLines } from "./subway-seoul.rules";
import type { SettledObservations } from "./subway-seoul.types";

const SEOUL_LINES = toSeoulLines(SUBWAY_REGISTRY);
const SEOUL_STATIONS = toSeoulStations(SUBWAY_REGISTRY);
const TRAIN_MAP_LINES = toTrainMapLines(SEOUL_LINES);
const API_SOURCE = "seoul-subway-api";
const TRAIN_MAP_SOURCE = "seoul-trainmap";

// WHY: no switch here: with SUBWAY=off nothing calls the provider (its pollers do not register). Each upstream
// call takes one from its source's daily ceiling first, so a runaway loop stops at the ceiling. A tick's calls
// settle apart, so one failing line drops no other line's trains (2026-10-17 05:16, line 4's page had no train).
@Injectable()
export class SubwaySeoulService {
  private readonly apiCap = new DailyCap(API_SOURCE, config.subway.apiDailyCap);
  private readonly trainMapCap = new DailyCap(TRAIN_MAP_SOURCE, config.subway.trainMapDailyCap);

  constructor(
    private readonly api: SubwaySeoulApiService,
    private readonly trainMap: SubwaySeoulTrainmapService,
    private readonly clock: Clock,
  ) {}

  async observeApi(): Promise<SettledObservations> {
    const take = <T>(call: () => Promise<T>): Promise<T> => this.withCap(this.apiCap, call);
    const fetchedAt = this.clock.now();
    const [eventResults, countdownResults] = await Promise.all([
      Promise.allSettled(SEOUL_LINES.map((line) => take(() => this.api.listLineEvents(line.lineName, line.platformIdByApiName, line.trainNumbers)))),
      Promise.allSettled(
        SEOUL_STATIONS.map((station) => take(() => this.api.listStationCountdownRows(station.seoulName, station.platformBySubwayId, fetchedAt))),
      ),
    ]);
    return toSettledObservations(API_SOURCE, eventResults, countdownResults);
  }

  async observeTrainMap(): Promise<SettledObservations> {
    const observedAt = this.clock.now();
    const eventResults = await this.withCap(this.trainMapCap, () => this.trainMap.listLineEventResults(TRAIN_MAP_LINES, observedAt));
    return toSettledObservations(TRAIN_MAP_SOURCE, eventResults, []);
  }

  private async withCap<T>(cap: DailyCap, call: () => Promise<T>): Promise<T> {
    cap.take(this.clock.now());
    return call();
  }
}
