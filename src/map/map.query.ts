// WHY: the fields each route reads, and no more: the overlay read leaves out every sheet's `detail`.
export const OVERLAY_PLACE_FIELDS = {
  _id: 1,
  campus: 1,
  category: 1,
  location: 1,
  title: 1,
  subtitle: 1,
  hours: 1,
  fields: 1,
  actions: 1,
  order: 1,
  facets: 1,
  orderByOption: 1,
} as const;

export const SHEET_PLACE_FIELDS = { _id: 1, category: 1, location: 1, title: 1, hours: 1, fields: 1, actions: 1, detail: 1 } as const;
