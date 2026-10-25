import { AppError } from "../../http/app.error";
import { isVerifiableSignedBody, type PushAuthorization, type PushCall } from "../../perimeter/perimeter.ports";

// WHY: the binding refuses a signed decision over a body it cannot vouch for, whatever the implementation decided.
export function toPushRefusal(call: PushCall, decision: PushAuthorization): AppError | null {
  if (!decision.allowed && decision.reason === "forbidden") return new AppError("FORBIDDEN", "this push call may not act for this mini app", 403);
  if (!decision.allowed || (decision.keyId !== null && !isVerifiableSignedBody(call))) return new AppError("UNAUTHORIZED", "the push call is not authenticated", 401);
  return null;
}
