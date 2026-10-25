const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_FIELD_PRIME = 2n ** 255n - 19n;

// EVIDENCE: the canonical encodings of the 8 Ed25519 points of order 1, 2, 4 and 8 (libsodium's blocklist): a
// signature under one can verify for messages nobody signed.
const SMALL_ORDER_POINTS = [
  "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "7P_______________________________________38",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA",
  "xxdqcD1N2E-6PAt2DRBnDyogU_osOczGTsf9d5KsA3o",
  "xxdqcD1N2E-6PAt2DRBnDyogU_osOczGTsf9d5KsA_o",
  "JuiVj8KyJ7BFw_SJ8u-Y8NXfrAXTxjM5sTgCiG1T_AU",
  "JuiVj8KyJ7BFw_SJ8u-Y8NXfrAXTxjM5sTgCiG1T_IU",
];

function toEncodedY(raw: Buffer): bigint {
  const yBytes = Buffer.from(raw);
  yBytes.writeUInt8(yBytes.readUInt8(ED25519_PUBLIC_KEY_BYTES - 1) & 0x7f, ED25519_PUBLIC_KEY_BYTES - 1);
  return BigInt(`0x${yBytes.reverse().toString("hex")}`);
}

const SMALL_ORDER_YS: ReadonlySet<bigint> = new Set(SMALL_ORDER_POINTS.map((point) => toEncodedY(Buffer.from(point, "base64url"))));

// WHY: OpenSSL also verifies forgeries under non-canonical spellings of those points (a set sign bit, a y of p or
// above), so the check is on y reduced to the field, not on the 8 canonical strings.
export function isWeakEd25519PublicKey(raw: Buffer): boolean {
  if (raw.length !== ED25519_PUBLIC_KEY_BYTES) return true;
  const encodedY = toEncodedY(raw);
  return encodedY >= ED25519_FIELD_PRIME || SMALL_ORDER_YS.has(encodedY);
}
