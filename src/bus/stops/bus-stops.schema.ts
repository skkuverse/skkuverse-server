import { z } from "zod";
import type { ScheduleStopCatalog } from "./bus-stops.types";
import { validateStopCatalog } from "./bus-stops.rules";

interface CatalogContext {
  knownServiceIds: ReadonlySet<string>;
  optIns: ReadonlyMap<string, readonly string[]>;
}

// WHY: the checks name each stop and service in the words the boot failure shows, so they stay rules this
// schema runs; the parse only carries them (ADR 0010 D5).
export function stopCatalogFile({ knownServiceIds, optIns }: CatalogContext): z.ZodType<ScheduleStopCatalog> {
  return z
    .unknown()
    .superRefine((raw, ctx) => {
      for (const message of validateStopCatalog(raw, knownServiceIds, optIns)) ctx.addIssue({ code: "custom", path: [], message });
    })
    .transform((raw) => raw as ScheduleStopCatalog);
}
