/**
 * ZodValidationPipe returns the parsed value, or throws an AppError with the failing field's code and the
 * schema's message, the field declared first winning.
 */
import { z } from "zod";
import { AppError } from "./app.error";
import { ZodValidationPipe } from "./zod-validation.pipe";

const campus = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.enum(["hssc", "nsc"], { error: "campus must be 'hssc' or 'nsc'" }).optional(),
);

const searchQuery = z.object({
  q: z
    .string({ error: "q parameter is required" })
    .trim()
    .min(1, { error: "q parameter is required" }),
  campus,
});

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected an AppError");
}

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe(searchQuery, "INVALID_PARAMS", {
    fieldCodes: { q: "MISSING_QUERY", campus: "INVALID_CAMPUS" },
  });

  it("returns the parsed value", () => {
    // Act & Assert
    expect(pipe.transform({ q: "  도서 ", campus: "" })).toEqual({ q: "도서", campus: undefined });
    expect(pipe.transform({ q: "27", campus: "nsc" })).toEqual({ q: "27", campus: "nsc" });
  });

  it("throws AppError with the field's code and the schema's message", () => {
    // Act
    const err = errorOf(() => pipe.transform({ q: "x", campus: "seoul" }));

    // Assert
    expect(err).toMatchObject({ code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'", httpStatus: 400 });
  });

  it("reports the field declared first when several fail", () => {
    // Act
    const err = errorOf(() => pipe.transform({ q: "   ", campus: "seoul" }));

    // Assert
    expect(err).toMatchObject({ code: "MISSING_QUERY", message: "q parameter is required" });
    expect(errorOf(() => pipe.transform({ campus: "seoul" })).code).toBe("MISSING_QUERY");
  });

  it("takes one code for a single value, and a status", () => {
    // Arrange
    const id = new ZodValidationPipe(
      z.coerce.number().int().positive({ error: "skkuId must be a positive integer" }),
      "INVALID_ID",
      { status: 422 },
    );

    // Act & Assert
    expect(id.transform("42")).toBe(42);
    expect(errorOf(() => id.transform("0"))).toMatchObject({
      code: "INVALID_ID",
      message: "skkuId must be a positive integer",
      httpStatus: 422,
    });
  });

  it("answers an issue with no field, or an unmapped one, with the default code", () => {
    // Arrange
    const range = z
      .object({ from: z.number(), to: z.number() })
      .superRefine((v, ctx) => {
        if (v.from > v.to) ctx.addIssue({ code: "custom", message: "from must not be after to" });
      });
    const rangePipe = new ZodValidationPipe(range, "INVALID_PARAMS", { fieldCodes: { from: "INVALID_FROM" } });

    // Act & Assert
    expect(errorOf(() => rangePipe.transform({ from: 2, to: 1 }))).toMatchObject({
      code: "INVALID_PARAMS",
      message: "from must not be after to",
    });
    expect(errorOf(() => rangePipe.transform("not an object")).code).toBe("INVALID_PARAMS");
    expect(errorOf(() => rangePipe.transform({ from: 1, to: "x" })).code).toBe("INVALID_PARAMS");
    expect(errorOf(() => rangePipe.transform({ from: "x", to: 1 })).code).toBe("INVALID_FROM");
  });
});
