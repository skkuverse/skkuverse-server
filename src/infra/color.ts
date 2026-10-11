// QUIRK(skkuverse-app): colors go out as bare six-digit hex (`F04452`, never `#F04452`): the app's
// `toCssColor` prepends the `#`.
const HEX6_RE = /^[0-9A-Fa-f]{6}$/;

export function isHex6(s: unknown): boolean {
  return typeof s === "string" && HEX6_RE.test(s);
}
