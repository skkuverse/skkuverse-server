import type { TrainNumbering } from "../subway.types";

export interface CountdownPlatform {
  platformId: string;
  trainNumbers: TrainNumbering;
}

// WHY: a served platform is matched by the statnId its rows carry; a neighbor, which the topology gives no statnId,
// by the name its rows write.
export interface PositionPlatformIds {
  platformIdByStatnId: ReadonlyMap<string, string>;
  platformIdByName: ReadonlyMap<string, string>;
}
