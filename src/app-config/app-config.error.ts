import { AppError } from "../http/app.error";

// WHY: the dataset loader's never-read answer; AppConfigService serves the features off instead, so /app/config,
// which the app reads at boot for its force-update gate, never answers it as a 503.
export class AppConfigFeaturesUnavailableError extends AppError {
  constructor() {
    super("APP_FEATURES_UNAVAILABLE", "The app features are unavailable", 503);
    this.name = "AppConfigFeaturesUnavailableError";
  }
}

// WHY: only a failed read of the dataset counts as unavailable; any other error is a fault in this code and reaches the filter as a 500.
export class AppConfigFeaturesReadError extends Error {
  constructor(cause: unknown) {
    super(`The app-features dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "AppConfigFeaturesReadError";
  }
}
