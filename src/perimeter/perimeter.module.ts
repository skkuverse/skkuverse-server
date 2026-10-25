import { Global, Module } from "@nestjs/common";
import config from "../infra/config";
import { perimeterProviders } from "./perimeter.config";
import { PORT_TOKENS } from "./perimeter.ports";

// SEE: docs/decisions/0023-perimeter-ports.md ("D4. One opaque overlay entry")
@Global()
@Module({ providers: perimeterProviders(config.perimeter.mode), exports: Object.values(PORT_TOKENS) })
export class PerimeterModule {}
