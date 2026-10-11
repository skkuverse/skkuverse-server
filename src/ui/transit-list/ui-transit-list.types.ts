export type BusGroupVisibility =
  | { type: "always" }
  | { type: "dateRange"; from: string; fromTime?: string; until: string };

export interface BusGroupSource {
  id: string;
  label: string;
  screenType: string;
  card: { themeColor: string; iconType: string; busTypeText: string; subtitle: string };
}
