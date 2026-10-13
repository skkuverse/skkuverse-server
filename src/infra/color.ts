// QUIRK(skkuverse-app): colors go out as bare six-digit hex (`F04452`, never `#F04452`): the app's
// `toCssColor` prepends the `#`.
const HEX6_RE = /^[0-9A-Fa-f]{6}$/;

export function isHex6(value: unknown): boolean {
  return typeof value === "string" && HEX6_RE.test(value);
}
