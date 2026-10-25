import { Injectable } from "@nestjs/common";
import type { CountdownRow, TrainEvent, TrainNumbering } from "../subway.types";
import { SubwaySeoulApiClient } from "./subway-seoul-api.client";
import { toCountdownRows, toTrainEvents } from "./subway-seoul-api.mapper";
import type { CountdownPlatform, PositionPlatformIds } from "./subway-seoul-api.types";

@Injectable()
export class SubwaySeoulApiService {
  constructor(private readonly client: SubwaySeoulApiClient) {}

  async listLineEvents(lineName: string, platformIds: PositionPlatformIds, trainNumbers: TrainNumbering): Promise<TrainEvent[]> {
    return toTrainEvents(await this.client.fetchPositions(lineName), platformIds, trainNumbers);
  }

  async listStationCountdownRows(seoulName: string, platformByStatnId: ReadonlyMap<string, CountdownPlatform>, fetchedAt: Date): Promise<CountdownRow[]> {
    return toCountdownRows(await this.client.fetchArrivals(seoulName), platformByStatnId, fetchedAt);
  }
}
