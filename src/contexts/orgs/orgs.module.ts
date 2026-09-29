import { Module } from "@nestjs/common";
import { OrgsService } from "./application/orgs.service";
import { OrgsController } from "./adapters/http/orgs.controller";

/** Tenant management. Depends on the auth context to provision a new tenant's first admin. */
@Module({
  controllers: [OrgsController],
  providers: [OrgsService],
})
export class OrgsModule {}
