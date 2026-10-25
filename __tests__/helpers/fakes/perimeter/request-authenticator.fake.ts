import type { Authentication, PerimeterRequest, RequestAuthenticator } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Answers every request with `authentication`, anonymous until a test sets it, and keeps the requests it saw. */
export class FakeRequestAuthenticator implements PublicOf<RequestAuthenticator> {
  authentication: Authentication = { kind: "anonymous" };
  readonly requests: PerimeterRequest[] = [];

  authenticate(request: PerimeterRequest): Promise<Authentication> {
    this.requests.push(request);
    return Promise.resolve(this.authentication);
  }
}
