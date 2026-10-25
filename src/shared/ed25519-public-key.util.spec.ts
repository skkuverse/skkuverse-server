/**
 * An Ed25519 public key is weak when it is not 32 bytes, when its y is p or above (a non-canonical spelling), or
 * when it encodes a point of order 1, 2, 4 or 8 in any spelling: under such a key a forged signature can verify.
 */
import { generateKeyPairSync } from "node:crypto";
import { isWeakEd25519PublicKey } from "./ed25519-public-key.util";

const rawOf = (key: string): Buffer => Buffer.from(key, "base64url");

describe("isWeakEd25519PublicKey", () => {
  it("passes a freshly generated key", () => {
    // Arrange
    const jwk = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" });

    // Act & Assert
    expect(isWeakEd25519PublicKey(rawOf(String(jwk.x)))).toBe(false);
  });

  it.each([
    ["the identity", "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["the identity with its sign bit set", "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA"],
    ["y = p + 1", "7v_______________________________________38"],
    ["a point of order 8", "xxdqcD1N2E-6PAt2DRBnDyogU_osOczGTsf9d5KsA3o"],
    ["y = p + 2, not small-order once reduced", "7________________________________________38"],
  ])("flags %s", (_label, key) => {
    // Act & Assert
    expect(isWeakEd25519PublicKey(rawOf(key))).toBe(true);
  });

  it("flags a key that is not 32 bytes", () => {
    // Act & Assert
    expect(isWeakEd25519PublicKey(Buffer.alloc(31, 1))).toBe(true);
  });
});
