import { z } from "zod";

export const idempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, { error: "Idempotency-Key must be 1-128 characters of A-Z, a-z, 0-9, _ and -" })
  .optional();
