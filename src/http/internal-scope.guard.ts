import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { InternalAuthorizer, type InternalScopeName } from "../perimeter/perimeter.ports";
import { AppError } from "./app.error";
import { toPerimeterRequest } from "./perimeter-request.mapper";

export const INTERNAL_SCOPE_METADATA = "skkuverse:internal-scope";

// SEE: docs/decisions/0023-perimeter-ports.md ("D1. Eight ports, one file") — a guard, so a refusal answers 401
// before any pipe reads the query or the body.
@Injectable()
export class InternalScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizer: InternalAuthorizer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.get<InternalScopeName | undefined>(INTERNAL_SCOPE_METADATA, context.getHandler());
    if (scope === undefined) throw new Error(`${context.getClass().name}.${context.getHandler().name} takes InternalScopeGuard without @InternalRoute`);
    const request = toPerimeterRequest(context.switchToHttp().getRequest<Request>());
    if (await this.authorizer.authorize(scope, request)) return true;
    throw new AppError("UNAUTHORIZED", "invalid or missing X-Internal-Token", 401);
  }
}
