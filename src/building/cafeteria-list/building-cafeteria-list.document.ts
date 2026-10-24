import type { CafeteriaDoc } from "../building.document";

export type ListedCafeteria = Pick<CafeteriaDoc, "_id" | "campus" | "name" | "buildNo" | "floor" | "spaceCd" | "location">;
