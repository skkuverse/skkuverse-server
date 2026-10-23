/**
 * The identities a `bus-service-notices` push names: each stored service id,
 * which must be a service the code defines (`busServices`).
 */
import { serviceNoticesReferences } from "./bus-schedule-content.rules";

describe("serviceNoticesReferences", () => {
  it("names each stored service as a busServices reference at its path, in stored order", () => {
    // Arrange
    const data = {
      services: {
        "campus-inja": { notices: [], suspend: null },
        "campus-jaja": { notices: [{ style: "info" as const, text: "공지" }], suspend: null },
      },
    };

    // Act
    const references = serviceNoticesReferences(data);

    // Assert
    expect(references).toEqual([
      { dataset: "busServices", id: "campus-inja", path: ["services", "campus-inja"] },
      { dataset: "busServices", id: "campus-jaja", path: ["services", "campus-jaja"] },
    ]);
  });

  it("names nothing for no stored service", () => {
    // Act & Assert
    expect(serviceNoticesReferences({ services: {} })).toEqual([]);
  });
});
