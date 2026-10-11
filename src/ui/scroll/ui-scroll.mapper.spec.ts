/**
 * The three scroll cards in a fixed order, their titles in the request
 * language and the lost-and-found card's page on the given web view origin.
 */
import { toScrollCards } from "./ui-scroll.mapper";
import { scrollCards } from "./ui-scroll.wire";

describe("toScrollCards", () => {
  it("lists the two campus maps, then lost and found on the web view origin", () => {
    // Act
    const cards = toScrollCards("en", "https://webview.test");

    // Assert
    expect(cards.map((card) => card.icon)).toEqual(["Icons.outbound", "Icons.outbound", "Icons.bus_alert"]);
    expect(cards[2]).toMatchObject({ color: "003626", pageWebviewLink: "https://webview.test/skku/lostandfound" });
    expect(scrollCards.safeParse(cards).success).toBe(true);
  });

  it("localizes the titles", () => {
    // Act
    const ko = toScrollCards("ko", "https://webview.test").map((card) => card.title);
    const en = toScrollCards("en", "https://webview.test").map((card) => card.title);

    // Assert
    expect(ko).toEqual(["인사캠 건물지도", "자과캠 건물지도", "분실물"]);
    expect(en).not.toEqual(ko);
  });
});
