/**
 * journeyRoutesDataset, the shape of the `journey-routes` dataset (ADR 0013, D5; ADR 0022, D4): revision 1 passes as
 * it is; a copy missing any field of the dataset, a line, a route, an option or a leg of each kind fails at its path;
 * an id outside `[a-z0-9-]{1,128}`, a place ref of an unknown kind, an empty evidence, minutes that are not a positive
 * whole number and a catch margin past five minutes fail. storedJourneyRoutes needs its revision and data.
 */
import { journeyRoutesFixture } from "../../__tests__/helpers/journey/journey-routes";
import { journeyRoutesDataset, storedJourneyRoutes } from "./journey.schema";

function messagesOf(raw: unknown): string[] {
  const result = journeyRoutesDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

const firstOption = (data: Record<string, any>) => data.routes[0].options[0];

describe("journeyRoutesDataset", () => {
  it("passes revision 1 as it is, in its order", () => {
    // Act
    const parsed = journeyRoutesDataset.parse(journeyRoutesFixture());

    // Assert
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(journeyRoutesFixture()));
  });

  it.each([
    ["the dataset", (data: Record<string, any>) => data, Object.keys(journeyRoutesDataset.shape)],
    ["a line", (data: Record<string, any>) => data.lines[0], Object.keys(journeyRoutesFixture().lines[0])],
    ["a route", (data: Record<string, any>) => data.routes[0], Object.keys(journeyRoutesFixture().routes[0]).filter((key) => key !== "options")],
    ["an option", firstOption, Object.keys(firstOption(journeyRoutesFixture())).filter((key) => key !== "legs")],
    ["a walk", (data: Record<string, any>) => firstOption(data).legs[0], ["from", "to", "minutes", "distanceM", "evidence"]],
    ["a ride", (data: Record<string, any>) => firstOption(data).legs[1], ["line", "board", "alight", "rideMinutes", "evidence"]],
  ])("fails %s missing any field it requires, at the field's path", (_case, at, fields) => {
    for (const field of fields) {
      // Arrange
      const data = journeyRoutesFixture();
      delete at(data)[field];

      // Act & Assert
      expect(messagesOf(data)).toEqual([expect.stringMatching(new RegExp(`(^|\\.)${field}: `))]);
    }
  });

  it.each([
    ["an uppercase route id", (data: Record<string, any>) => (data.routes[0].id = "Hssc-to-nsc"), "routes.0.id: must be 1-128 characters of a-z, 0-9 and -"],
    ["an id of 129 characters", (data: Record<string, any>) => (data.lines[0].id = "a".repeat(129)), "lines.0.id: must be 1-128 characters of a-z, 0-9 and -"],
    ["a place of an unknown kind", (data: Record<string, any>) => (data.routes[0].from = "campus_gate:1"), expect.stringMatching(/^routes\.0\.from: must be <kind>:<id>/)],
    ["an empty evidence", (data: Record<string, any>) => (firstOption(data).legs[0].evidence = " "), "routes.0.options.0.legs.0.evidence: required: where the minutes come from"],
    ["zero minutes", (data: Record<string, any>) => (firstOption(data).legs[0].minutes = 0), expect.stringMatching(/^routes\.0\.options\.0\.legs\.0\.minutes: /)],
    ["fractional minutes", (data: Record<string, any>) => (firstOption(data).legs[1].rideMinutes = 82.5), expect.stringMatching(/^routes\.0\.options\.0\.legs\.1\.rideMinutes: /)],
    ["a catch margin of 301 s", (data: Record<string, any>) => (data.catchMarginSec = 301), expect.stringMatching(/^catchMarginSec: /)],
  ])("fails %s", (_case, edit, message) => {
    // Arrange
    const data = journeyRoutesFixture();
    edit(data);

    // Act & Assert
    expect(messagesOf(data)).toEqual([message]);
  });

  it("passes a catch margin of 300 s and a digits-only place id, as an official stop code would be", () => {
    // Arrange
    const data = journeyRoutesFixture();
    data.catchMarginSec = 300;
    data.routes[0].to = "skku_building:01616";
    firstOption(data).legs[2].to = "skku_building:01616";

    // Act & Assert
    expect(messagesOf(data)).toEqual([]);
  });
});

describe("storedJourneyRoutes", () => {
  it("needs the revision beside the data", () => {
    // Act & Assert
    expect(storedJourneyRoutes.safeParse({ revision: 1, data: journeyRoutesFixture() }).success).toBe(true);
    expect(storedJourneyRoutes.safeParse({ data: journeyRoutesFixture() }).success).toBe(false);
  });
});
