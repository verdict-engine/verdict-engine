import { Module } from "@nestjs/common";
import { LISTS_PORT } from "./application/lists.port";
import { StoreLists } from "./adapters/store/store-lists.adapter";

@Module({
  providers: [{ provide: LISTS_PORT, useClass: StoreLists }],
  exports: [LISTS_PORT],
})
export class ListsModule {}

export { LISTS_PORT };
