export interface TmapFeature {
  type: "Feature";
  /** QUIRK(tmap): [lng, lat]. */
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    index?: number;
    pointType?: string;
    time?: number;
    totalTime?: number;
    [k: string]: unknown;
  };
}

export interface TmapPredictionResponse {
  type: string;
  features?: TmapFeature[];
}

export interface TmapCall {
  appKey: string;
  retryDelayMs?: number;
}

export interface FeatureMarks {
  offsets: number[];
  marks: Array<[number, number]>;
  waypoints: number;
  ended: boolean;
}
