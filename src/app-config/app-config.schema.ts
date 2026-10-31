import { z } from "zod";
import { ANDROID_API_LEVEL_PATTERN, APP_VERSION_PATTERN, IOS_VERSION_PATTERN, STORE_UPDATE_URL_HOSTS } from "./app-config.constants";
import type { AppPlatformGates, StoredAppPlatformGates } from "./app-config.document";
import { appClientConfig } from "./app-config.wire";

// WHY: `URL.host` is the hostname plus any port, without the userinfo, so an exact match refuses a port or a
// look-alike suffix, and the userinfo is checked apart.
const storeUpdateUrl = z
  .url({ protocol: /^https$/, abort: true })
  .refine((value) => {
    const { host, username, password } = new URL(value);
    return STORE_UPDATE_URL_HOSTS.has(host) && username === "" && password === "";
  });

// WHY: stricter than the wire, which a reader parses leniently: the stored gate must be one the app can compare.
const storedPlatformGate = (osVersionPattern: RegExp, updateUrl: z.ZodType<string | null>) =>
  z.strictObject({
    ...appClientConfig.shape.ios.shape,
    minVersion: z.string().regex(APP_VERSION_PATTERN),
    updateUrl,
    minOsVersion: z.string().regex(osVersionPattern),
  });

const platformGatesDataset = (updateUrl: z.ZodType<string | null>) =>
  z.strictObject({
    ios: storedPlatformGate(IOS_VERSION_PATTERN, updateUrl),
    android: storedPlatformGate(ANDROID_API_LEVEL_PATTERN, updateUrl),
  }) satisfies z.ZodType<AppPlatformGates>;

export const appPlatformGatesDataset = platformGatesDataset(storeUpdateUrl);

// WHY: a stored updateUrl no store serves reads as null, so a tampered one cannot switch the gate off with a failed parse.
export const storedAppPlatformGates = z.object({
  revision: z.int().positive(),
  data: platformGatesDataset(storeUpdateUrl.nullable().catch(null)),
}) satisfies z.ZodType<StoredAppPlatformGates>;
