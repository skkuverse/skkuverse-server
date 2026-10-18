import type { TrainNumbering } from "../subway.types";

export interface CountdownPlatform {
  platformId: string;
  trainNumbers: TrainNumbering;
}
