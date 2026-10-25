/**
 * (A perimeter detail is left out of the public history.)
 */
import crypto from "node:crypto";

export interface TestSigningKey {
  keyId: string;
  publicKey: string;
  privateKey: crypto.KeyObject;
}

export function newSigningKey(): TestSigningKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  if (typeof x !== "string") throw new Error("an Ed25519 JWK without x");
  const keyId = crypto.createHash("sha256").update(Buffer.from(x, "base64url")).digest("hex").slice(0, 16);
  return { keyId, publicKey: x, privateKey };
}

export interface SignedCall {
  method: string;
  target: string;
  timestampSeconds: number;
  idempotencyKey?: string;
  body?: string;
}

export function stringToSign({ method, target, timestampSeconds, idempotencyKey = "", body = "" }: SignedCall): string {
  const bodySha256 = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  return `v1:${timestampSeconds}:${method}:${target}:${idempotencyKey}:${bodySha256}`;
}

/** The headers a signed call carries, Idempotency-Key included when the call has one. */
export function signedHeaders(key: Pick<TestSigningKey, "keyId" | "privateKey">, call: SignedCall): Record<string, string> {
  const signature = crypto.sign(null, Buffer.from(stringToSign(call), "utf8"), key.privateKey).toString("base64url");
  return {
    "X-Skkuverse-Key-Id": key.keyId,
    "X-Skkuverse-Timestamp": String(call.timestampSeconds),
    "X-Skkuverse-Signature": signature,
    ...(call.idempotencyKey === undefined ? {} : { "Idempotency-Key": call.idempotencyKey }),
  };
}
