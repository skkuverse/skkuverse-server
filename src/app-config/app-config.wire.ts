import { z } from "zod";

/** WHY: below `minVersion` the app blocks on its force-update screen. */
const platformGate = z.object({
  minVersion: z.string(),
  updateUrl: z.string().nullable(),
});

/**
 * CONTRACT(skkuverse-app): read by skkuverse-app/packages/shared/src/app/parser.ts, which documents each
 * field. Additive only: installed apps ignore keys they do not know.
 */
export const appClientConfig = z.object({
  ios: platformGate,
  android: platformGate,
  webview: z.object({ bridgeOrigins: z.array(z.string()) }),
  web: z.object({ origin: z.string() }),
  /** WHY: keyed by origin, so the keys are data, not fields. */
  miniapps: z.object({ origins: z.record(z.string(), z.string()) }),
});

export type AppClientConfig = z.input<typeof appClientConfig>;
