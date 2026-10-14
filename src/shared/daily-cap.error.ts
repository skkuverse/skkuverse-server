import type { DirectionsProvider } from "./directions.types";

export class DailyCapError extends Error {
  constructor(
    readonly provider: DirectionsProvider,
    readonly cap: number,
  ) {
    super(`${provider}: daily cap of ${cap} calls reached`);
    this.name = "DailyCapError";
  }
}
