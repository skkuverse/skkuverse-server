import { InternalAuthorizer, type PerimeterDeps } from "../perimeter.ports";
import { announceLocalDev } from "./local-dev-banner";

export class LocalDevInternalAuthorizer extends InternalAuthorizer {
  constructor(deps: PerimeterDeps) {
    super();
    announceLocalDev(deps, "internalAuthorizer");
  }

  authorize(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
