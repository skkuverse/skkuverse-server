import type { InternalAuthorizer, InternalScopeName, PerimeterRequest } from "../../../../src/perimeter/perimeter.ports";
import type { PublicOf } from "../public-of";

/** Answers every call with `allowed`, true until a test sets it, and keeps the scopes it was asked for. */
export class FakeInternalAuthorizer implements PublicOf<InternalAuthorizer> {
  allowed = true;
  readonly calls: Array<{ scope: InternalScopeName; request: PerimeterRequest }> = [];

  authorize(scope: InternalScopeName, request: PerimeterRequest): Promise<boolean> {
    this.calls.push({ scope, request });
    return Promise.resolve(this.allowed);
  }
}
