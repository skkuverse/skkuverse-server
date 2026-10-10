import { Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppError } from "./app.error";

/**
 * Validates one request input (`@Query()`, `@Param("id")`, `@Body()`) with a zod
 * schema and returns the parsed value. A failure throws
 * `AppError(code, message, status)`, so the body is the usual
 * `{ error: { code, message } }`:
 *
 *   - the message is the first issue's message, so the schema states it
 *     (`z.enum(["hssc", "nsc"], { error: "campus must be 'hssc' or 'nsc'" })`);
 *   - the code is `fieldCodes[<the issue's top-level key>]`, else `code`. An
 *     issue with no field (a `superRefine` across fields, a non-object input)
 *     takes `code`. zod reports object issues in shape order, so the field
 *     declared first is the one reported when several fail.
 *
 * Validate a multi-field query as one object rather than with one pipe per
 * `@Query("x")`: Nest runs parameter pipes concurrently, so which failing
 * parameter answers would not be defined.
 */
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly code: string,
    private readonly fieldCodes: Readonly<Record<string, string>> = {},
    private readonly status = 400,
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const issue = result.error.issues[0]!;
    const field = issue.path[0];
    const code = (typeof field === "string" && this.fieldCodes[field]) || this.code;
    throw new AppError(code, issue.message, this.status);
  }
}
