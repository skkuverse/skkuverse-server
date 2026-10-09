import { Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppError } from "./app.error";

/** One code for every failure, or one per top-level field of an object schema. */
export type ValidationCode = string | Readonly<Record<string, string>>;

/**
 * Validates one request input (`@Query()`, `@Param("id")`, `@Body()`) with a zod
 * schema and returns the parsed value. A failure throws
 * `AppError(code, message, status)`, so the body is the usual
 * `{ error: { code, message } }`:
 *
 *   - the message is the first issue's message, so the schema states it
 *     (`z.enum(["hssc", "nsc"], { error: "campus must be 'hssc' or 'nsc'" })`);
 *   - with a per-field code map, the first issue's top-level key picks the
 *     code. zod reports object issues in shape order, so the field declared
 *     first is the one reported when several fail.
 *
 * Validate a multi-field query as one object rather than with one pipe per
 * `@Query("x")`: Nest runs parameter pipes concurrently, so which failing
 * parameter answers would not be defined.
 */
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly code: ValidationCode,
    private readonly status = 400,
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const issue = result.error.issues[0]!;
    throw new AppError(this.codeFor(issue.path), issue.message, this.status);
  }

  private codeFor(path: readonly PropertyKey[]): string {
    if (typeof this.code === "string") return this.code;
    const field = String(path[0]);
    const code = this.code[field];
    if (code === undefined) {
      throw new Error(`ZodValidationPipe: no error code for field "${field}"`);
    }
    return code;
  }
}
