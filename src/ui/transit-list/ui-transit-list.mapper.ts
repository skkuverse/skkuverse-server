import type { BusGroup } from "../../bus/config/bus-config.wire";
import type { TransitList } from "./ui-transit-list.wire";

type BusGroupCard = TransitList[number];

export function toBusGroupCard(group: Pick<BusGroup, "id" | "label" | "screenType" | "card">): BusGroupCard {
  return {
    groupId: group.id,
    card: {
      label: group.label,
      themeColor: group.card.themeColor,
      iconType: group.card.iconType,
      busTypeText: group.card.busTypeText,
      // WHY: `||`, not `??`: a blank subtitle is served as null too.
      subtitle: group.card.subtitle || null,
    },
    action: { route: group.screenType === "realtime" ? "/bus/realtime" : "/bus/schedule", groupId: group.id },
  };
}
