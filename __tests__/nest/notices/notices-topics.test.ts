/**
 * The topic mapping the push dispatch sends to: a source's fixed tab and the picker tabs that list it, under
 * TOPIC_CAP, Firestore's `array-contains-any` limit that the push Cloud Function enforces.
 */
import { buildTopics, TOPIC_CAP } from "../../../src/notices/notices.topics";

describe("TOPIC_CAP", () => {
  it("is 30, Firestore's array-contains-any limit", () => {
    // Assert
    expect(TOPIC_CAP).toBe(30);
  });
});

describe("buildTopics", () => {
  it("names a fixed tab's source as category:<tab>", () => {
    // Act & Assert
    expect(buildTopics({ sourceId: "skku-notice02" })).toEqual(["category:academic"]);
  });

  it("names a picker tab's source as <tab>:<source>", () => {
    // Act & Assert
    expect(buildTopics({ sourceId: "lib-hssc" })).toEqual(["library:lib-hssc"]);
  });

  it("returns no topic for a source no tab lists, a missing source or no document", () => {
    // Act & Assert
    expect([buildTopics({ sourceId: "skku-main" }), buildTopics({}), buildTopics(null), buildTopics(undefined)]).toEqual([[], [], [], []]);
  });
});
