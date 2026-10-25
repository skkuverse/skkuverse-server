import { Module } from "@nestjs/common";

// SEE: docs/decisions/0022-journey-and-call-spec.md ("D6. Producers are doors over a shared interface"): one sub-module per source.
@Module({})
export class BusDeparturesModule {}
