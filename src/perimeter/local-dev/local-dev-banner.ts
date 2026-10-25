import net from "node:net";
import { PORT_LABELS, type PerimeterDeps, type PortName } from "../perimeter.ports";

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

function isLoopbackHost(host: string): boolean {
  const family = net.isIP(host);
  return family !== 0 && LOOPBACK.check(host, family === 4 ? "ipv4" : "ipv6");
}

// WHY: an empty host is the poller's, which listens nowhere; any other must be loopback, whatever the mode check said.
export function announceLocalDev(deps: PerimeterDeps, port: PortName): void {
  if (deps.host !== "" && !isLoopbackHost(deps.host)) {
    throw new Error(`${PORT_LABELS[port]}: the local-development perimeter serves loopback only (HOST=${deps.host})`);
  }
  deps.logger.warn(
    { event: "perimeter.local_dev.constructed", port: PORT_LABELS[port] },
    "Local-development perimeter: not the production one; never expose this server",
  );
}
