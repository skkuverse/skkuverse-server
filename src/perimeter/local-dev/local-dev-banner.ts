import { isLoopbackAddress } from "../../shared/ip-address.util";
import { PORT_LABELS, type PerimeterDeps, type PortName } from "../perimeter.ports";

// WHY: any host must be loopback, whatever the mode check said.
export function announceLocalDev(deps: PerimeterDeps, port: PortName): void {
  if (deps.host !== null && !isLoopbackAddress(deps.host)) {
    throw new Error(`${PORT_LABELS[port]}: the local-development perimeter serves loopback only (HOST=${deps.host})`);
  }
  deps.logger.warn(
    { event: "perimeter.local_dev.constructed", port: PORT_LABELS[port] },
    "Local-development perimeter: not the production one; never expose this server",
  );
}
