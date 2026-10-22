/**
 * The push check a schema cannot hold: the stored attributes name exactly the
 * Jongro routes the checked-out code serves. A route the code serves without
 * attributes, and attributes for a route it does not serve, are each named at
 * `routes.<routeId>`.
 */
import { routeAttributesFixture } from "../../../__tests__/helpers/bus/route-attributes";
import { JONGRO_ROUTES } from "../bus.constants";
import { toRouteAttributesIssues } from "./bus-route-attributes.rules";

const CODE_ROUTE_IDS = JONGRO_ROUTES.map((route) => route.id);

describe("toRouteAttributesIssues", () => {
  it("finds none for revision 1 against the code's routes", () => {
    // Act & Assert
    expect(toRouteAttributesIssues(routeAttributesFixture(), CODE_ROUTE_IDS)).toEqual([]);
  });

  it("Route missing: names jongro08 when the attributes hold jongro02 and jongro07 only", () => {
    // Arrange
    const attributes = routeAttributesFixture();
    delete attributes.routes.jongro08;

    // Act & Assert
    expect(toRouteAttributesIssues(attributes, CODE_ROUTE_IDS)).toEqual([
      { path: ["routes", "jongro08"], message: 'missing: the checked-out code serves "jongro08", so it needs attributes' },
    ]);
  });

  it("names a route the code does not serve", () => {
    // Arrange
    const attributes = routeAttributesFixture();
    attributes.routes.jongro13 = attributes.routes.jongro07!;

    // Act & Assert
    expect(toRouteAttributesIssues(attributes, CODE_ROUTE_IDS)).toEqual([
      { path: ["routes", "jongro13"], message: '"jongro13" is not a route the checked-out code serves' },
    ]);
  });

  it("names every missing route in the code's order, then every unknown one", () => {
    // Arrange
    const attributes = { routes: { jongro99: routeAttributesFixture().routes.jongro02!, jongro07: routeAttributesFixture().routes.jongro07! } };

    // Act
    const issues = toRouteAttributesIssues(attributes, CODE_ROUTE_IDS);

    // Assert
    expect(issues.map((issue) => issue.path.join("."))).toEqual(["routes.jongro02", "routes.jongro08", "routes.jongro99"]);
  });

  it("finds none for an empty code list and empty attributes", () => {
    // Act & Assert
    expect(toRouteAttributesIssues({ routes: {} }, [])).toEqual([]);
  });

  it("does not take an Object.prototype name for a stored route", () => {
    // Act & Assert
    expect(toRouteAttributesIssues({ routes: {} }, ["constructor"])).toEqual([
      { path: ["routes", "constructor"], message: 'missing: the checked-out code serves "constructor", so it needs attributes' },
    ]);
  });
});
