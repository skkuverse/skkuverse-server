import { z } from "zod";
import type { StoredAppFeatures } from "./app-config.document";
import type { AppFeatures } from "./app-config.types";

export const appFeaturesDataset = z.strictObject({ sharedMapShell: z.boolean() }) satisfies z.ZodType<AppFeatures>;

export const storedAppFeatures = z.object({ revision: z.int().positive(), data: appFeaturesDataset }) satisfies z.ZodType<StoredAppFeatures>;
