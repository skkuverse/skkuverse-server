export interface PlatformGate {
  minVersion: string;
  updateUrl: string | null;
}

/** GET /app/config. Additive only: installed apps read `ios` and `android` and ignore keys they don't know. */
export interface AppClientConfig {
  ios: PlatformGate;
  android: PlatformGate;
  webview: {
    /** Origins allowed to reach the app's native bridge (src/infra/origins.ts). */
    bridgeOrigins: string[];
  };
  web: {
    /** The launcher origin the app builds mini-app share links and home-screen shortcuts on. */
    origin: string;
  };
  miniapps: {
    /** First-party mini-app origin → mini-app id; the app opens those URLs in that mini app's shell, not /webview. */
    origins: Record<string, string>;
  };
}
