import type { JongroRouteAttributesData } from "./bus-route-attributes.types";

// CONTRACT(scripts): written by scripts/lib/datasets/store.js (npm run data), which validates at push;
// the server still parses it where it reads it.
export interface JongroRouteAttributesDatasetDoc {
  _id: string;
  revision: number;
  data: JongroRouteAttributesData;
  updatedAt: Date;
  updatedBy: string;
}

export type StoredRouteAttributes = Pick<JongroRouteAttributesDatasetDoc, "revision" | "data">;
