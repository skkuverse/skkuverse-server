type TransitItemReference = { kind: "bus"; groupId: string } | { kind: "subway"; stationId: string } | { kind: "link"; id: string };

export function toTransitItemId(reference: TransitItemReference): string {
  if (reference.kind === "bus") return `bus:${reference.groupId}`;
  if (reference.kind === "subway") return `subway:${reference.stationId}`;
  return reference.id;
}
