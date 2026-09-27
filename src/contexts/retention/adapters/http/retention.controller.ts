import { BadRequestException, Body, Controller, Get, Inject, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { STORE, type Store, type StoreStats } from "@shared/ports/store.port";
import { type DiskUsage, diskHealth } from "@shared/observability/disk-health";
import { type StorageComponent, storageComponents } from "@shared/observability/storage-breakdown";
import { DISK } from "../../../../config/disk";
import { RetentionConfigDto } from "../../../../docs/api-dto";

/**
 * The storage report: the logical document-store size, the health of the disks that data lives on,
 * and a per-service breakdown of the space consumed on those disks.
 */
interface StorageReport extends StoreStats {
  readonly disks: ReadonlyArray<DiskUsage>;
  readonly components: ReadonlyArray<StorageComponent>;
}
import {
  RETENTION_SETTINGS,
  RetentionConfigError,
  type RetentionSettings,
  type RetentionSnapshot,
} from "../../application/retention-settings";
import { PruneService, type PruneReport } from "../../application/prune.service";

interface RetentionPatch {
  verdicts?: number | null;
  activity?: number | null;
  replay?: number | null;
  idempotency?: number | null;
  deadLetter?: number | null;
}

@ApiTags("Settings")
@ApiBearerAuth("bearer")
@Controller("v1/config")
@UseGuards(AdminGuard)
export class RetentionController {
  constructor(
    @Inject(RETENTION_SETTINGS) private readonly settings: RetentionSettings,
    @Inject(STORE) private readonly store: Store,
    private readonly prune: PruneService,
  ) {}

  @Get("retention")
  @ApiOperation({
    summary: "Get retention settings",
    description:
      "Admin only. The retention window (in days) for each append-only collection and whether it is a dashboard override or the env default. 0 means keep forever.",
  })
  retention_get(): Promise<RetentionSnapshot> {
    return this.settings.snapshot();
  }

  @Put("retention")
  @ApiOperation({
    summary: "Update retention settings",
    description:
      "Admin only. Set the retention window (days) per collection. 0 keeps that collection forever; send a field as null to revert it to the env default. Applies on the next sweep (within ~10s across replicas).",
  })
  @ApiBody({ type: RetentionConfigDto })
  async retention_put(@Body() body: RetentionPatch): Promise<RetentionSnapshot> {
    try {
      return await this.settings.update(body);
    } catch (e) {
      if (e instanceof RetentionConfigError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }

  @Post("retention/run")
  @ApiOperation({
    summary: "Run retention prune now",
    description: "Admin only. Trigger a retention sweep immediately and return how many records were pruned per collection.",
  })
  retention_run(): Promise<PruneReport> {
    return this.prune.sweep();
  }

  @Get("storage")
  @ApiOperation({
    summary: "Get storage usage",
    description:
      "Admin only. The document store's size and per-collection row counts, the health of the filesystems that data lives on (total / free / used, for Docker volume monitoring), and a per-service breakdown of the space consumed on disk.",
  })
  async storage(): Promise<StorageReport> {
    const stats = await this.store.stats();
    const [disks, components] = await Promise.all([
      diskHealth(DISK.paths),
      storageComponents(stats.totalBytes),
    ]);
    return { ...stats, disks, components };
  }
}
