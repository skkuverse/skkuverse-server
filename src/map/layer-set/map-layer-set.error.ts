// WHY: not an AppError: with no good layer sets read yet the routes serve the base map, never a 503 (ADR 0013 D6).
export class MapLayerSetsUnavailableError extends Error {
  constructor() {
    super("The map layer sets are unavailable");
    this.name = "MapLayerSetsUnavailableError";
  }
}

// WHY: only a failed read of the dataset is unavailable; any other error is a fault in this code.
export class MapLayerSetsReadError extends Error {
  constructor(cause: unknown) {
    super(`The map layer sets dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "MapLayerSetsReadError";
  }
}
