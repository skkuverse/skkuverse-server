import { Injectable } from "@nestjs/common";
import type { CountdownRow, TrainEvent } from "../subway.types";
import { SubwaySeoulApiClient } from "./subway-seoul-api.client";
import { toCountdownRows, toTrainEvents } from "./subway-seoul-api.mapper";

@Injectable()
export class SubwaySeoulApiService {
  constructor(private readonly client: SubwaySeoulApiClient) {}

  async listLineEvents(lineName: string, stationIdByName: ReadonlyMap<string, string>): Promise<TrainEvent[]> {
    return toTrainEvents(await this.client.fetchPositions(lineName), stationIdByName);
  }

  async listStationCountdownRows(stationName: string, stationIdByName: ReadonlyMap<string, string>): Promise<CountdownRow[]> {
    return toCountdownRows(await this.client.fetchArrivals(stationName), stationIdByName);
  }
}
