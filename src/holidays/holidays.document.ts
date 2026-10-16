import type { PublicHoliday } from "./holidays.types";

export interface PublicHolidaysDoc {
  _id: number;
  holidays: PublicHoliday[];
  fetchedAt: Date;
}
