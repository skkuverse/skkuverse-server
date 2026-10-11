export interface PlatformGate {
  minVersion: string;
  updateUrl: string | null;
}

/**
 * CONTRACT(skkuverse-app): read by skkuverse-app/packages/shared/src/app/parser.ts, which documents each
 * field. Additive only: installed apps ignore keys they do not know.
 */
export interface AppClientConfig {
  ios: PlatformGate;
  android: PlatformGate;
  webview: {
    bridgeOrigins: string[];
  };
  web: {
    origin: string;
  };
  miniapps: {
    origins: Record<string, string>;
  };
}
