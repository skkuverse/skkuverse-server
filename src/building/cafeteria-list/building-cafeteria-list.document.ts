import type { CafeteriaDoc } from "../cafeteria/building-cafeteria.document";

export type ListedCafeteria = Pick<CafeteriaDoc, "_id" | "campus" | "name" | "buildNo" | "floor" | "spaceCd" | "location">;
