/**
 * A bus group becomes its card on the transit tab: the group's label and card
 * fields, a blank subtitle sent as null, and the screen it opens by its type.
 */
import { toBusGroupCard } from "./ui-transit-list.mapper";
import type { BusGroupSource } from "./ui-transit-list.types";
import { transitList } from "./ui-transit-list.wire";

function group(overrides: Partial<BusGroupSource> = {}): BusGroupSource {
  return {
    id: "hssc",
    label: "인사캠 셔틀버스",
    screenType: "realtime",
    card: { themeColor: "003626", iconType: "shuttle", busTypeText: "성대", subtitle: "정차소 ↔ 600주년 기념관" },
    ...overrides,
  };
}

describe("toBusGroupCard", () => {
  it("maps a realtime group to its card and the realtime screen", () => {
    // Act
    const card = toBusGroupCard(group());

    // Assert
    expect(card).toEqual({
      groupId: "hssc",
      card: {
        label: "인사캠 셔틀버스",
        themeColor: "003626",
        iconType: "shuttle",
        busTypeText: "성대",
        subtitle: "정차소 ↔ 600주년 기념관",
      },
      action: { route: "/bus/realtime", groupId: "hssc" },
    });
    expect(transitList.safeParse([card]).success).toBe(true);
  });

  it("opens the schedule screen for a schedule group and sends a blank subtitle as null", () => {
    // Arrange
    const schedule = group({ id: "campus", screenType: "schedule", card: { ...group().card, subtitle: "" } });

    // Act
    const card = toBusGroupCard(schedule);

    // Assert
    expect(card.action).toEqual({ route: "/bus/schedule", groupId: "campus" });
    expect(card.card.subtitle).toBeNull();
  });
});
