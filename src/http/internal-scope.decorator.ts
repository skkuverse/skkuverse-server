import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { InternalScopeName } from "../perimeter/perimeter.ports";
import { INTERNAL_SCOPE_METADATA, InternalScopeGuard } from "./internal-scope.guard";

export const InternalScope = (scope: InternalScopeName): MethodDecorator => SetMetadata(INTERNAL_SCOPE_METADATA, scope);

export const InternalRoute = (scope: InternalScopeName): MethodDecorator => applyDecorators(InternalScope(scope), UseGuards(InternalScopeGuard));
