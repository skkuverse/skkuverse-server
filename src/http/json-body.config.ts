import type { json, Request } from "express";
import type { IncomingMessage } from "node:http";
import { escapeRegex } from "../shared/regex.util";

type JsonBodyOptions = NonNullable<Parameters<typeof json>[0]>;

const PARAM_SEGMENT = /^:\w+$/;

// WHY: exact path and case, unlike the router, so the bytes kept are those of the one route that verifies them.
function toPathPattern(routePath: string): RegExp {
  const segments = routePath.split("/").map((segment) => (PARAM_SEGMENT.test(segment) ? "[^/?]+" : escapeRegex(segment)));
  return new RegExp(`^${segments.join("/")}(?:\\?|$)`);
}

export function jsonBodyOptions(rawBodyRoutePaths: readonly string[]): JsonBodyOptions {
  const patterns = rawBodyRoutePaths.map(toPathPattern);
  return {
    limit: "100kb",
    verify: (req: IncomingMessage, _res: unknown, body: Buffer): void => {
      if (patterns.some((pattern) => pattern.test(req.url ?? ""))) (req as Request).rawBody = body;
    },
  };
}
