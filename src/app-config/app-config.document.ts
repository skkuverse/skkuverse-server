import type { AppClientConfig } from "./app-config.wire";

export type AppPlatformGates = Pick<AppClientConfig, "ios" | "android">;

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface AppPlatformGatesDatasetDoc {
  _id: string;
  revision: number;
  data: AppPlatformGates;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredAppPlatformGates = Pick<AppPlatformGatesDatasetDoc, "revision" | "data">;
