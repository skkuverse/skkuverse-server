import type { I18n } from "../../infra/types";
import type { MapChipActionSpec } from "../map.types";
import type { EventFacetDef, EventListSort, LayerSet } from "./map-layer-set.schema";

export interface MapChipSpec {
  id: string;
  emoji: string;
  label: I18n;
  action: MapChipActionSpec;
  /** WHY: stated, not derived: with scheduled layers the default view depends on the time of day. */
  isReset: boolean;
  list: { facets: EventFacetDef[]; sort: EventListSort } | null;
}

export type LoadedConfig = { config: LayerSet; error: null } | { config: null; error: string };
