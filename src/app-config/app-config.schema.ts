import { z } from "zod";
import { ANDROID_API_LEVEL_PATTERN, APP_VERSION_PATTERN, IOS_VERSION_PATTERN } from "./app-config.constants";
import type { AppPlatformGates, StoredAppPlatformGates } from "./app-config.document";
import { isOwnStoreListing } from "./app-config.rules";
import { appClientConfig } from "./app-config.wire";

type GatePlatform = "ios" | "android";

const storeUpdateUrl = (platform: GatePlatform) => z.string().refine((value) => isOwnStoreListing(platform, value));

// WHY: stricter than the wire, which a reader parses leniently: the stored gate must be one the app can compare.
const storedPlatformGate = (osVersionPattern: RegExp, updateUrl: z.ZodType<string | null>) =>
  z.strictObject({
    ...appClientConfig.shape.ios.shape,
    minVersion: z.string().regex(APP_VERSION_PATTERN),
    updateUrl,
    minOsVersion: z.string().regex(osVersionPattern),
  });

const platformGatesDataset = (updateUrl: (platform: GatePlatform) => z.ZodType<string | null>) =>
  z.strictObject({
    ios: storedPlatformGate(IOS_VERSION_PATTERN, updateUrl("ios")),
    android: storedPlatformGate(ANDROID_API_LEVEL_PATTERN, updateUrl("android")),
  }) satisfies z.ZodType<AppPlatformGates>;

export const appPlatformGatesDataset = platformGatesDataset(storeUpdateUrl);

// WHY: a stored updateUrl that is not this app's own listing reads as null, so a tampered one cannot switch the gate off with a failed parse.
export const storedAppPlatformGates = z.object({
  revision: z.int().positive(),
  data: platformGatesDataset((platform) => storeUpdateUrl(platform).nullable().catch(null)),
}) satisfies z.ZodType<StoredAppPlatformGates>;
