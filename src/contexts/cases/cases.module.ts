import { Module } from "@nestjs/common";
import { CASE_REPOSITORY_PORT } from "./application/case-repository.port";
import { CASES_PORT } from "./application/cases.port";
import { CaseService } from "./application/case.service";
import { CasesController } from "./adapters/http/cases.controller";
import { StoreCaseRepository } from "./adapters/store/store-case.repository";

/** CaseService is bound as CASES_PORT and its onModuleInit subscription registers at boot. */
@Module({
  controllers: [CasesController],
  providers: [
    CaseService,
    { provide: CASES_PORT, useExisting: CaseService },
    { provide: CASE_REPOSITORY_PORT, useClass: StoreCaseRepository },
  ],
  exports: [CASES_PORT],
})
export class CasesModule {}

export { CASES_PORT };
