import type { Campus } from "../../building.types";

export type CampusHint = Campus | "both" | null;

export interface PlaceMention { text: string; campusHint: CampusHint; source: string | null }
