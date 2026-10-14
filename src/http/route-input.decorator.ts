import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

// WHY: a route's path and query parameters as one object, so one schema validates them in shape order: Nest
// runs parameter pipes concurrently, and which failing one answers would be undefined.
export const RouteInput = createParamDecorator((_data: unknown, ctx: ExecutionContext): Record<string, unknown> => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ...req.query, ...req.params };
});
