import net from "node:net";

type Family = "ipv4" | "ipv6";

function toBlockList(cidrs: { readonly [F in Family]: readonly string[] }): net.BlockList {
  const list = new net.BlockList();
  for (const family of ["ipv4", "ipv6"] as const) {
    for (const cidr of cidrs[family]) {
      const [prefix = "", bits = ""] = cidr.split("/");
      list.addSubnet(prefix, Number(bits), family);
    }
  }
  return list;
}

// QUIRK(node): BlockList checks an IPv4-mapped IPv6 address against the IPv4 rules, so ::ffff:127.0.0.1 matches.
const LOOPBACK = toBlockList({ ipv4: ["127.0.0.0/8"], ipv6: ["::1/128"] });

// EVIDENCE: the IANA IPv4 and IPv6 special-purpose registries: loopback, private, link-local (the cloud metadata
// address), CGNAT, documentation, multicast, reserved, and the IPv6 forms embedding an IPv4. ::ffff:0:0/96, which
// would match every IPv4 through the QUIRK above, is not listed.
const NON_PUBLIC = toBlockList({
  ipv4: [
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
    "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
    "224.0.0.0/4", "240.0.0.0/4",
  ],
  ipv6: [
    "::/96", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001::/23", "2001:db8::/32", "2002::/16", "fc00::/7",
    "fec0::/10", "fe80::/10", "ff00::/8",
  ],
});

function familyOf(address: string): Family | null {
  const family = net.isIP(address);
  if (family === 0) return null;
  return family === 4 ? "ipv4" : "ipv6";
}

export function isLoopbackAddress(address: string): boolean {
  const family = familyOf(address);
  return family !== null && LOOPBACK.check(address, family);
}

export function isPublicAddress(address: string): boolean {
  const family = familyOf(address);
  return family !== null && !NON_PUBLIC.check(address, family);
}
