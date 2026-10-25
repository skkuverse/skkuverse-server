/**
 * The request view a port decides on (ADR 0023, D1) carries the request line as received, so a decision over the
 * target sees the query the caller sent and not a path a router rewrote; headers are read by name.
 */
import type { Request } from "express";
import { toPerimeterRequest } from "./perimeter-request.mapper";

describe("toPerimeterRequest", () => {
  it("keeps the method, the original URL with its query, the IP and a header reader", () => {
    // Arrange
    const headers: Record<string, string> = { "x-internal-token": "t" };
    const req = { method: "POST", originalUrl: "/internal/notices/dispatch-pending?cycle=1", url: "/dispatch-pending", ip: "198.51.100.7", get: (name: string) => headers[name.toLowerCase()] };

    // Act
    const request = toPerimeterRequest(req as unknown as Request);

    // Assert
    expect([request.method, request.target, request.ip]).toEqual(["POST", "/internal/notices/dispatch-pending?cycle=1", "198.51.100.7"]);
    expect([request.header("X-Internal-Token"), request.header("authorization")]).toEqual(["t", undefined]);
  });

  it("leaves the IP undefined when Express has none", () => {
    // Arrange
    const req = { method: "GET", originalUrl: "/", ip: undefined, get: () => undefined };

    // Act & Assert
    expect(toPerimeterRequest(req as unknown as Request).ip).toBeUndefined();
  });
});
