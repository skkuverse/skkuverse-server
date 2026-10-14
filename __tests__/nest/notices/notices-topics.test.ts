/**
 * (An operations detail is left out of the public history.)
 */
import { buildTopics, TOPIC_CAP } from "../../../src/notices/notices.topics";

describe("TOPIC_CAP", () => {
  it("is 30 (at most the Cloud Function's PUSH_FUNCTION_NAME_01)", () => {
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
