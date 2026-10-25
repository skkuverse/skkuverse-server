/**
 * The known-answer vector docs/reference/miniapps-api.md publishes ("Known-answer vector"), read from the doc itself,
 * so a test checks what a mini app's developer checks a signer against.
 */
import fs from "node:fs";
import path from "node:path";

export interface SigningVector {
  privateKeyPem: string;
  publicKey: string;
  keyId: string;
  method: string;
  target: string;
  timestamp: string;
  idempotencyKey: string;
  body: string;
  stringToSign: string;
  signature: string;
}

const DOC = path.join(__dirname, "../../../docs/reference/miniapps-api.md");

export function publishedSigningVector(): SigningVector {
  const doc = fs.readFileSync(DOC, "utf8");
  const block = /#### Known-answer vector[\s\S]*?```json\n([\s\S]*?)```/.exec(doc);
  if (block === null) throw new Error(`${DOC} publishes no known-answer vector`);
  return JSON.parse(block[1]!) as SigningVector;
}
