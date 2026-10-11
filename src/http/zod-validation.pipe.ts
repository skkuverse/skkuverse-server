import { Injectable, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { AppError } from "./app.error";

interface ZodValidationOptions {
  readonly fieldCodes?: Readonly<Record<string, string>>;
  readonly status?: number;
}

// WHY: validate a multi-field query as one object, not one pipe per `@Query("x")`: Nest runs parameter
// pipes concurrently, so which failing one answers would be undefined. zod reports issues in shape order.
@Injectable()
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  private readonly fieldCodes: Readonly<Record<string, string>>;
  private readonly status: number;

  constructor(
    private readonly schema: S,
    private readonly code: string,
    { fieldCodes = {}, status = 400 }: ZodValidationOptions = {},
  ) {
    this.fieldCodes = fieldCodes;
    this.status = status;
  }

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const [issue] = result.error.issues;
    if (!issue) throw new Error("zod failed a parse without reporting an issue");
    const field = issue.path[0];
    const code = (typeof field === "string" && this.fieldCodes[field]) || this.code;
    throw new AppError(code, issue.message, this.status);
  }
}
