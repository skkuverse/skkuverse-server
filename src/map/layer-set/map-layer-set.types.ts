import type { I18n } from "../../infra/types";
import type { MapChipActionSpec, MapTab } from "../map.types";
import type { EventFacetDef, EventListSort, LayerSet } from "./map-layer-set.schema";

export interface MapChipSpec {
  id: string;
  emoji: string;
  label: I18n;
  action: MapChipActionSpec;
  /** WHY: stated, not derived: with scheduled layers the default view depends on the time of day. */
  isReset: boolean;
  list: { facets: EventFacetDef[]; sort: EventListSort } | null;
  tabs?: readonly MapTab[];
  opensIn?: MapTab;
}

export type ConfigIssue = readonly [path: PropertyKey[], message: string];

export interface RejectedLayerSet {
  index: number;
  layerSetId: string | null;
  issues: string[];
}

export interface CheckedLayerSets {
  layerSets: LayerSet[];
  rejected: RejectedLayerSet[];
}

export interface MapLayerSetsRevision extends CheckedLayerSets {
  revision: number;
}
