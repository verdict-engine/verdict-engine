import { Module } from "@nestjs/common";
import { GRAPH_PORT } from "./application/graph.port";
import { GraphService } from "./application/graph.service";
import { GraphController } from "./adapters/http/graph.controller";

@Module({
  controllers: [GraphController],
  providers: [
    GraphService,
    { provide: GRAPH_PORT, useExisting: GraphService },
  ],
  exports: [GRAPH_PORT],
})
export class GraphModule {}

export { GRAPH_PORT };
