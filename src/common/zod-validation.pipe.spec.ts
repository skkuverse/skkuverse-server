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
  const pipe = new ZodValidationPipe(searchQuery, { q: "MISSING_QUERY", campus: "INVALID_CAMPUS" });

  it("returns the parsed value", () => {
    expect(pipe.transform({ q: "  도서 ", campus: "" })).toEqual({ q: "도서", campus: undefined });
    expect(pipe.transform({ q: "27", campus: "nsc" })).toEqual({ q: "27", campus: "nsc" });
  });

  it("throws AppError with the field's code and the schema's message", () => {
    const err = errorOf(() => pipe.transform({ q: "x", campus: "seoul" }));
    expect(err).toMatchObject({ code: "INVALID_CAMPUS", message: "campus must be 'hssc' or 'nsc'", httpStatus: 400 });
  });

  it("reports the field declared first when several fail", () => {
    const err = errorOf(() => pipe.transform({ q: "   ", campus: "seoul" }));
    expect(err).toMatchObject({ code: "MISSING_QUERY", message: "q parameter is required" });
    expect(errorOf(() => pipe.transform({ campus: "seoul" })).code).toBe("MISSING_QUERY");
  });

  it("takes one code for a single value, and a status", () => {
    const id = new ZodValidationPipe(
      z.coerce.number().int().positive({ error: "skkuId must be a positive integer" }),
      "INVALID_ID",
      422,
    );
    expect(id.transform("42")).toBe(42);
    expect(errorOf(() => id.transform("0"))).toMatchObject({
      code: "INVALID_ID",
      message: "skkuId must be a positive integer",
      httpStatus: 422,
    });
  });

  it("fails loudly when a failing field has no code", () => {
    const partial = new ZodValidationPipe(searchQuery, { q: "MISSING_QUERY" });
    expect(() => partial.transform({ q: "x", campus: "seoul" })).toThrow(/no error code for field "campus"/);
  });
});
