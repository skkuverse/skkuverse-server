type TransitItemReference =
  | { kind: "bus"; groupId: string }
  | { kind: "subway"; stationId: string }
  | { kind: "link"; id: string }
  | { kind: "group"; id: string };

export function toTransitItemId(reference: TransitItemReference): string {
  if (reference.kind === "bus") return `bus:${reference.groupId}`;
  if (reference.kind === "subway") return `subway:${reference.stationId}`;
  if (reference.kind === "group") return `group:${reference.id}`;
  return reference.id;
}
