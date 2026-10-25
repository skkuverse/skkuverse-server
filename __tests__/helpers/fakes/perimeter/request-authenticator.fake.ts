import type { Authentication, PerimeterRequest, RequestAuthenticator } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Answers each request as `answer` scripts, anonymous until a test sets it, and keeps the requests it saw. */
export class FakeRequestAuthenticator implements PublicOf<RequestAuthenticator> {
  answer: (request: PerimeterRequest) => Authentication = () => ({ kind: "anonymous" });
  readonly requests: PerimeterRequest[] = [];

  authenticate(request: PerimeterRequest): Promise<Authentication> {
    this.requests.push(request);
    return Promise.resolve(this.answer(request));
  }
}

/**
 * A script for `answer`: a bearer token `<t>` is the user `uid-<t>`, a token in `rejected` is rejected, and a
 * request without one is anonymous.
 */
export function answerByBearer(rejected: readonly string[] = []): (request: PerimeterRequest) => Authentication {
  return (request) => {
    const authorization = request.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return { kind: "anonymous" };
    const token = authorization.slice("Bearer ".length);
    return rejected.includes(token) ? { kind: "rejected" } : { kind: "user", uid: `uid-${token}`, signInProvider: "anonymous" };
  };
}
