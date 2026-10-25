/**
 * (A perimeter detail is left out of the public history.)
 */
import crypto from "node:crypto";
import { signedHeaders, stringToSign } from "../../helpers/miniapps/signing-keys";
import { publishedSigningVector } from "../../helpers/miniapps/signing-vector";

// EVIDENCE: RFC 8032 section 7.1, TEST 1, the public key.
const RFC_8032_TEST_1_PUBLIC_KEY = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

const vector = publishedSigningVector();
const privateKey = crypto.createPrivateKey(vector.privateKeyPem);
const call = { method: vector.method, target: vector.target, timestampSeconds: Number(vector.timestamp), idempotencyKey: vector.idempotencyKey, body: vector.body };

describe("the published signing vector", () => {
  it("uses RFC 8032's TEST 1 key, whose public half and keyId it lists", () => {
    // Act
    const publicKey = crypto.createPublicKey(privateKey).export({ format: "jwk" }).x;

    // Assert
    expect([publicKey, Buffer.from(vector.publicKey, "base64url").toString("hex")]).toEqual([vector.publicKey, RFC_8032_TEST_1_PUBLIC_KEY]);
    expect(crypto.createHash("sha256").update(Buffer.from(vector.publicKey, "base64url")).digest("hex").slice(0, 16)).toBe(vector.keyId);
  });

  it("is what the tests' signer builds and signs for the published call", () => {
    // Act
    const headers = signedHeaders({ keyId: vector.keyId, privateKey }, call);

    // Assert
    expect(stringToSign(call)).toBe(vector.stringToSign);
    expect(headers).toEqual({
      "X-Skkuverse-Key-Id": vector.keyId,
      "X-Skkuverse-Timestamp": vector.timestamp,
      "X-Skkuverse-Signature": vector.signature,
      "Idempotency-Key": vector.idempotencyKey,
    });
  });
});
