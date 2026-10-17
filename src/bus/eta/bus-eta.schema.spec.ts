/**
 * A fixed value as a prediction reuses it: a fixed live document as the live poller writes it, read through the
 * reuse projection, passes; one missing any projected field, or with offsets that are not numbers, fails there.
 */
import { fixedEstimate } from "./bus-eta.schema";

// WHY: the projection of a live document live/bus-eta-live.mapper.ts writes; a root spec does not import a child flow.
const captured = (): Record<string, unknown> => ({
  _id: "campus-inja|regular|2026-10-13|13:30|live",
  serviceId: "campus-inja",
  routeType: "regular",
  date: "2026-10-13",
  time: "13:30",
  offsetsSec: [0, 4320],
});

describe("fixedEstimate", () => {
  it("passes a fixed live document's projection as it is", () => {
    // Act
    const parsed = fixedEstimate.parse(captured());

    // Assert
    expect(parsed).toEqual(captured());
  });

  it.each(Object.keys(fixedEstimate.shape))("fails a document without %s at that field", (field) => {
    // Arrange
    const doc = captured();
    delete doc[field];

    // Act
    const result = fixedEstimate.safeParse(doc);

    // Assert
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });

  it("fails offsets that are not numbers", () => {
    // Arrange
    const doc = { ...captured(), offsetsSec: [0, "4320"] };

    // Act
    const result = fixedEstimate.safeParse(doc);

    // Assert
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["offsetsSec", 1]]);
  });
});
