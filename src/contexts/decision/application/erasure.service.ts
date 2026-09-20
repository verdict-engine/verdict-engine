import { Inject, Injectable } from "@nestjs/common";
import { GRAPH_PORT, type GraphPort } from "@contexts/graph/application/graph.port";
import { ANOMALY_PORT, type AnomalyPort } from "@contexts/anomaly/application/anomaly.port";
import { logEvent } from "@shared/observability/log";
import { REPLAY_LOG_PORT, type ReplayLogPort } from "./replay-log.port";
import { ACTIVITY_LOG_PORT, type ActivityLogPort } from "./activity-log.port";

export interface ErasureResult {
  userId: string;
  replaySamplesRemoved: number;
  activityEntriesRemoved: number;
  graph: boolean;
  baseline: boolean;
}

/**
 * Right-to-erasure across the stores that hold a user's personal data: the graph identity,
 * the learned spending baseline, the replay log (which keeps whole events), and the activity
 * log (which keeps the masked request per decision). The append-only verdict log is
 * intentionally out of scope — it holds only an event id, verdict and tags, and is governed by
 * a retention window, not per-subject deletion.
 */
@Injectable()
export class ErasureService {
  constructor(
    @Inject(GRAPH_PORT) private readonly graph: GraphPort,
    @Inject(ANOMALY_PORT) private readonly anomaly: AnomalyPort,
    @Inject(REPLAY_LOG_PORT) private readonly replay: ReplayLogPort,
    @Inject(ACTIVITY_LOG_PORT) private readonly activity: ActivityLogPort,
  ) {}

  async eraseUser(userId: string): Promise<ErasureResult> {
    await this.anomaly.erase(userId);
    await this.graph.erase("user", userId);
    const replaySamplesRemoved = await this.replay.eraseSubject(userId);
    const activityEntriesRemoved = await this.activity.eraseSubject(userId);
    logEvent("info", "privacy.erased", { userId, replaySamplesRemoved, activityEntriesRemoved });
    return { userId, replaySamplesRemoved, activityEntriesRemoved, graph: true, baseline: true };
  }
}
