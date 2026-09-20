import { BadRequestException, Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { GRAPH_PORT, type GraphPort, type Neighborhood } from "../../application/graph.port";
import type { EntityKind } from "../../domain/graph";

const KINDS: ReadonlySet<string> = new Set<EntityKind>(["user", "device", "ip", "phone"]);

@ApiTags("Graph")
@ApiBearerAuth("bearer")
@Controller("v1/graph")
@UseGuards(AuthGuard)
export class GraphController {
  constructor(@Inject(GRAPH_PORT) private readonly graph: GraphPort) {}

  @Get(":kind/:id")
  @ApiOperation({ summary: "Entity neighborhood", description: "The linked entities around a node (shared devices, IPs, phones) plus ring size — for investigating fraud rings and SIM-box patterns." })
  @ApiParam({ name: "kind", enum: ["user", "device", "ip", "phone"] })
  @ApiParam({ name: "id", description: "The entity identifier of that kind." })
  neighborhood(@Param("kind") kind: string, @Param("id") id: string): Promise<Neighborhood> {
    if (!KINDS.has(kind)) throw new BadRequestException({ error: true, message: "kind must be user, device or ip" });
    return this.graph.neighborhood(kind as EntityKind, id);
  }
}
