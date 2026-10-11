import type { SupportedLang } from "../../infra/types";
import type { MapChipSpec } from "../layer-set/map-layer-set.types";
import type { LayerSpec } from "../map.types";

export interface MapConfigSource {
  lang: SupportedLang;
  styleId: string | undefined;
  layers: readonly LayerSpec[];
  chips: readonly MapChipSpec[];
}
