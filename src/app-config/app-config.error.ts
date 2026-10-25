import { AppError } from "../http/app.error";

// WHY: the gates are the force-update floor, so no default may stand in for them; the app reads a failed
// /app/config as "no gate this launch" and keeps its last good copy (skkuverse-app app-config.client.ts).
export class AppConfigPlatformGatesUnavailableError extends AppError {
  constructor() {
    super("APP_PLATFORM_GATES_UNAVAILABLE", "The app platform gates are unavailable", 503);
    this.name = "AppConfigPlatformGatesUnavailableError";
  }
}

// WHY: only a failed read of the dataset counts as unavailable; any other error is a fault in this code and reaches the filter as a 500.
export class AppConfigPlatformGatesReadError extends Error {
  constructor(cause: unknown) {
    super(`The app-platform-gates dataset could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "AppConfigPlatformGatesReadError";
  }
}
