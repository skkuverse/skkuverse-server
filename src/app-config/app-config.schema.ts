import { z } from "zod";
import { ANDROID_API_LEVEL_PATTERN, APP_VERSION_PATTERN, IOS_VERSION_PATTERN } from "./app-config.constants";
import type { AppPlatformGates, StoredAppPlatformGates } from "./app-config.document";
import { appClientConfig } from "./app-config.wire";

// WHY: stricter than the wire, which a reader parses leniently: the stored gate must be one the app can compare.
const storedPlatformGate = (osVersionPattern: RegExp) =>
  z.strictObject({
    ...appClientConfig.shape.ios.shape,
    minVersion: z.string().regex(APP_VERSION_PATTERN),
    updateUrl: z.url({ protocol: /^https$/ }),
    minOsVersion: z.string().regex(osVersionPattern),
  });

export const appPlatformGatesDataset = z.strictObject({
  ios: storedPlatformGate(IOS_VERSION_PATTERN),
  android: storedPlatformGate(ANDROID_API_LEVEL_PATTERN),
}) satisfies z.ZodType<AppPlatformGates>;

export const storedAppPlatformGates = z.object({
  revision: z.int().positive(),
  data: appPlatformGatesDataset,
}) satisfies z.ZodType<StoredAppPlatformGates>;
