/**
 * The send's Idempotency-Key header: absent is no key, and a present key is
 * 1-128 characters of A-Z, a-z, 0-9, `_` and `-`, refused with the message
 * the 400 shows at one below, at and one above each bound.
 */
import { idempotencyKeyHeader } from "./miniapps-notifications.schema";

const MESSAGE = "Idempotency-Key must be 1-128 characters of A-Z, a-z, 0-9, _ and -";

describe("idempotencyKeyHeader", () => {
  it("reads an absent header as no key", () => {
    // Act & Assert
    expect(idempotencyKeyHeader.parse(undefined)).toBeUndefined();
  });

  it.each(["k", "k".repeat(127), "k".repeat(128), "Retry_2026-10-22", "0123456789"])("accepts %j as given", (key) => {
    // Act & Assert
    expect(idempotencyKeyHeader.parse(key)).toBe(key);
  });

  it.each(["", "k".repeat(129), "retry 1", " retry", "retry.1", "retry/1", "schlüssel", "retry\t1"])("refuses %j", (key) => {
    // Act
    const result = idempotencyKeyHeader.safeParse(key);

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(MESSAGE);
  });
});
