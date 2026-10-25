import { z } from "zod";

/** WHY: below `minVersion` the app blocks on its force-update screen. */
const platformGate = z.object({
  minVersion: z.string(),
  updateUrl: z.string().nullable(),
  /**
   * WHY: the lowest OS that can install the store build meeting `minVersion` (iOS a version, Android an API
   * level); below it the gate lets the user through. Optional for a reader: a body cached before it was served has none.
   */
  minOsVersion: z.string().optional(),
});

/**
 * CONTRACT(skkuverse-app): read by skkuverse-app/packages/shared/src/schema/app-config.schema.ts
 * (`parseAppConfig`), which documents each field. Additive only: installed apps ignore keys they do not know.
 */
export const appClientConfig = z.object({
  ios: platformGate,
  android: platformGate,
  webview: z.object({ bridgeOrigins: z.array(z.string()) }),
  web: z.object({ origin: z.string() }),
  /** WHY: keyed by origin, so the keys are data, not fields. */
  miniapps: z.object({ origins: z.record(z.string(), z.string()) }),
  /** WHY: optional for a reader: a body cached before the key was served has none, which means no hosted game. */
  games: z.object({ origins: z.record(z.string(), z.string()) }).optional(),
});

export type AppClientConfig = z.input<typeof appClientConfig>;
