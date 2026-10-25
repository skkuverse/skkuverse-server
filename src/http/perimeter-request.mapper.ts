import type { Request } from "express";
import type { PerimeterRequest } from "../perimeter/perimeter.ports";

// WHY: `originalUrl`, the request line as received, never `url`, which a router rewrites under a mount path.
export function toPerimeterRequest(req: Request): PerimeterRequest {
  return { method: req.method, target: req.originalUrl, ip: req.ip, header: (name) => req.get(name) };
}
