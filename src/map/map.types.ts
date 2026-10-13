import type { I18n } from "../infra/types";

export interface CameraMotion {
  zoom: number;
  tilt: number;
  bearing: number;
  durationMs: number;
}

export interface MapCamera extends CameraMotion {
  lat: number;
  lng: number;
}

/** WHY: wall-clock "HH:MM", half-open `[start, end)`; `start > end` wraps past midnight. */
export interface DailyWindow {
  start: string;
  end: string;
}

/** WHY: a tuple, so the schedule with no window that `always` already spells cannot be written in BASE_LAYERS. */
export type LayerVisibility =
  | { kind: "always" }
  | { kind: "never" }
  | { kind: "scheduled"; windows: [DailyWindow, ...DailyWindow[]] };

export type MapLayerStyle = Partial<
  Record<"outlineWidth" | "fillOpacity" | "minZoom" | "maxZoom" | "width" | "height" | "size" | "captionTextSize" | "zIndex", number>
> & { color?: string; outlineColor?: string };

export interface LayerSpec {
  id: string;
  markerStyle?: string;
  label: I18n;
  defaultVisibleWhen: LayerVisibility;
  userConfigurable: boolean;
  endpoint: string;
  chipGroupId: string | null;
  style?: MapLayerStyle;
}


export type MapChipActionSpec =
  | { kind: "webview"; url: string }
  | { kind: "focus"; camera: MapCamera; layerIds: readonly string[] };

export type ConfigIssue = readonly [path: PropertyKey[], message: string];
