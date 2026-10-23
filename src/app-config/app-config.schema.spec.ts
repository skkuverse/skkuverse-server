/**
 * appFeaturesDataset, the shape of the `app-features` dataset: the app's
 * kill switches, today `sharedMapShell` alone. A push is refused on it and the
 * read parses with it. Revision 1 (the fixture) passes as it is, in both
 * positions; a copy without `sharedMapShell`, a value that is not a boolean
 * and a key the dataset does not hold are each refused at their path.
 * storedAppFeatures, the stored document as the repository reads it, needs its
 * revision and data.
 */
import { appFeaturesFixture } from "../../__tests__/helpers/app-config/app-features";
import { appFeaturesDataset, storedAppFeatures } from "./app-config.schema";

function messagesOf(raw: unknown): string[] {
  const result = appFeaturesDataset.safeParse(raw);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("appFeaturesDataset", () => {
  it("passes revision 1 as it is", () => {
    // Act
    const parsed = appFeaturesDataset.parse(appFeaturesFixture());

    // Assert
    expect(parsed).toEqual({ sharedMapShell: false });
  });

  it("passes the switch turned on", () => {
    // Act & Assert
    expect(messagesOf({ sharedMapShell: true })).toEqual([]);
  });

  it("fails a copy without sharedMapShell, naming it", () => {
    // Act & Assert
    expect(messagesOf({})).toEqual(["sharedMapShell: Invalid input: expected boolean, received undefined"]);
  });

  it.each<[string, unknown]>([
    ["the string false", "false"],
    ["0", 0],
    ["null", null],
  ])("fails sharedMapShell given %s", (_label, value) => {
    // Act & Assert
    expect(messagesOf({ sharedMapShell: value })).toEqual([expect.stringMatching(/^sharedMapShell: Invalid input: expected boolean/)]);
  });

  it("fails a key the dataset does not hold, naming it", () => {
    // Act & Assert
    expect(messagesOf({ sharedMapShell: false, sharedMapShel: true })).toEqual([': Unrecognized key: "sharedMapShel"']);
  });
});

describe("storedAppFeatures", () => {
  it("passes a stored document's revision and data", () => {
    // Act
    const parsed = storedAppFeatures.parse({ revision: 3, data: appFeaturesFixture() });

    // Assert
    expect(parsed).toEqual({ revision: 3, data: { sharedMapShell: false } });
  });

  it.each([["revision"], ["data"]])("fails a document without %s", (field) => {
    // Arrange
    const doc: Record<string, unknown> = { revision: 3, data: appFeaturesFixture() };
    delete doc[field];

    // Act
    const result = storedAppFeatures.safeParse(doc);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path)).toEqual([[field]]);
  });
});
