import type { MiniAppRegistry } from "../ui.types";

export interface TransitLayoutReferences {
  busGroupIds: readonly string[];
  stationIds: readonly string[];
  registry: MiniAppRegistry;
}
