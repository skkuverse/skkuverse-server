import { AppError } from "../../http/app.error";

// WHY: the dataset loader's never-read answer; SubwayStationCoordsService turns it into no coords, so no route answers
// it as a 503 (ADR 0013, D6: a documented answer that serves without the dataset).
export class SubwayStationCoordsUnavailableError extends AppError {
  constructor() {
    super("SUBWAY_STATION_COORDS_UNAVAILABLE", "The subway station coords are unavailable", 503);
    this.name = "SubwayStationCoordsUnavailableError";
  }
}

// WHY: only a failed read of the dataset counts as unavailable; any other error is a fault in this code and reaches the filter as a 500.
export class SubwayStationCoordsReadError extends Error {
  constructor(cause: unknown) {
    super(`The subway-station-coords dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "SubwayStationCoordsReadError";
  }
}
