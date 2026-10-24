/** WHY: every served field but `displayNo`, which the read derives (`buildingDoc`); the writer's bookkeeping stays out. */
const SERVED_BUILDING_FIELDS = {
  _id: 1,
  buildNo: 1,
  type: 1,
  campus: 1,
  name: 1,
  description: 1,
  location: 1,
  image: 1,
  attachments: 1,
  accessibility: 1,
  skkuCreatedAt: 1,
  skkuUpdatedAt: 1,
  updatedAt: 1,
} as const;

export { SERVED_BUILDING_FIELDS };
