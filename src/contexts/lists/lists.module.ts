import { Module } from "@nestjs/common";
import { LISTS_PORT } from "./application/lists.port";
import { InMemoryLists } from "./adapters/in-memory/in-memory-lists.adapter";

@Module({
  providers: [{ provide: LISTS_PORT, useClass: InMemoryLists }],
  exports: [LISTS_PORT],
})
export class ListsModule {}

export { LISTS_PORT };
