import type { Request, Response } from "express";

export function startResponseTimer(req: Request): void {
  req.__startNs = process.hrtime.bigint();
}

export function setResponseTime(req: Request, res: Response): void {
  const start = req.__startNs ?? process.hrtime.bigint();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  res.setHeader("X-Response-Time", `${ms.toFixed(1)}ms`);
}
