/**
 * A place's sheet on the wire: its head typed, each block and button read on
 * its own and dropped with a reason when broken, and the whole sheet dropped
 * only when its head is unreadable.
 */
import type { MapPlaceDoc } from "../map.document";
import { toPlaceDetail } from "./map-event-details.mapper";

function place(detail: unknown): MapPlaceDoc {
  return { _id: "p", detail } as unknown as MapPlaceDoc;
}

const HEAD = { kind: "booth", org: { ko: "총학" }, isUnion: true, locationLabel: null, actions: [], blocks: [] };

describe("toPlaceDetail", () => {
  it("serves the head with text resolved and the fields in the app's order", () => {
    // Act
    const detail = toPlaceDetail(place(HEAD), []);

    // Assert
    expect(detail).toEqual({ placeId: "p", kind: "booth", org: { ko: "총학", en: "총학" }, isUnion: true, locationLabel: null, actions: [], blocks: [] });
    expect(Object.keys(detail ?? {})).toEqual(["placeId", "kind", "org", "isUnion", "locationLabel", "actions", "blocks"]);
  });

  it.each([{ ...HEAD, kind: "concert" }, { ...HEAD, blocks: null }, "detail"])("drops the sheet with an unreadable head: %j", (detail) => {
    // Arrange
    const dropped: string[] = [];

    // Act & Assert
    expect(toPlaceDetail(place(detail), dropped)).toBeNull();
    expect(dropped).toEqual(["p: detail is unreadable (kind, blocks or actions)"]);
  });

  it("keeps each good block and drops each broken one with its reason", () => {
    // Arrange
    const dropped: string[] = [];
    const blocks = [
      { type: "text", id: "intro", body: { ko: "소개" } },
      { type: "text", id: "empty" },
      { type: "image", id: "photo", url: "https://evil.com/a.png" },
      { type: "poll", id: "vote" },
      { type: "table", id: "menu", title: { ko: "메뉴" }, rows: [{ label: { ko: "닭꼬치" }, value: { ko: "5,000원" } }] },
    ];

    // Act
    const detail = toPlaceDetail(place({ ...HEAD, blocks }), dropped);

    // Assert
    expect(detail?.blocks.map((b) => b.id)).toEqual(["intro", "menu"]);
    expect(dropped).toEqual([
      "p.blocks[1].empty: text block is missing a required field",
      'p.blocks[2].photo: image url "https://evil.com/a.png" is not on the media host',
      'p.blocks[3].vote: unknown block type "poll"',
    ]);
  });

  it("keeps an Instagram button without its bad post, and drops a link that is not https", () => {
    // Arrange
    const dropped: string[] = [];
    const actions = [
      { type: "instagram", id: "ig", label: { ko: "인스타" }, profileUrl: "https://www.instagram.com/example", postUrl: "https://example.com" },
      { type: "link", id: "web", label: { ko: "웹" }, url: "http://example.com" },
    ];

    // Act
    const detail = toPlaceDetail(place({ ...HEAD, actions }), dropped);

    // Assert
    expect(detail?.actions).toEqual([
      { type: "instagram", id: "ig", label: { ko: "인스타", en: "인스타" }, profileUrl: "https://www.instagram.com/example", postUrl: null },
    ]);
    expect(dropped).toEqual([
      'p.actions[0].ig: postUrl "https://example.com" is not an Instagram post',
      'p.actions[1].web: url "http://example.com" is not an absolute https URL',
    ]);
  });
});
