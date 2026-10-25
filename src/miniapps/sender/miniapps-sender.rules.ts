import { AppError } from "../../http/app.error";
import type { PushAuthorization, PushCall } from "../../perimeter/perimeter.ports";

// SEE: docs/decisions/0023-perimeter-ports.md ("D6. Signed calls") — a signature covers the bytes sent, so a signed
// decision over a decoded body, or over none, is refused here whatever the implementation decided.
const isUnverifiableBody = ({ request, rawBody }: PushCall): boolean =>
  request.header("content-encoding") !== undefined || (request.method === "POST" && rawBody === undefined);

export function toPushRefusal(call: PushCall, decision: PushAuthorization): AppError | null {
  if (!decision.allowed && decision.reason === "forbidden") return new AppError("FORBIDDEN", "this push call may not act for this mini app", 403);
  if (!decision.allowed || (decision.keyId !== null && isUnverifiableBody(call))) return new AppError("UNAUTHORIZED", "the push call is not authenticated", 401);
  return null;
}
