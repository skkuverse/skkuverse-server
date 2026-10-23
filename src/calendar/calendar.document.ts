import type { PublicHoliday } from "./calendar.types";

export interface PublicHolidaysDoc {
  _id: number;
  holidays: PublicHoliday[];
  fetchedAt: Date;
}
