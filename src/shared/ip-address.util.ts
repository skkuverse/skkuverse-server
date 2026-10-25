import net from "node:net";

// QUIRK(node): BlockList checks an IPv4-mapped IPv6 address against the IPv4 rules, so ::ffff:127.0.0.1 matches.
const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export function isLoopbackAddress(address: string): boolean {
  const family = net.isIP(address);
  return family !== 0 && LOOPBACK.check(address, family === 4 ? "ipv4" : "ipv6");
}
