import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { Mutex } from "@shared/domain/mutex";
import {
  VERDICT_REACHED,
  type VerdictReachedPayload,
} from "@contexts/decision/application/decision.contracts";
import {
  LABEL_RECORDED,
  type LabelRecordedPayload,
} from "@contexts/feedback/application/label.contracts";
import { emptyModel, recordLabel, weightOf, type ModelDoc } from "../domain/model";
import type { ModelPort, TagWeight } from "./model.port";

const DOC = "weights";

interface Sample {
  readonly tags: string[];
}

/**
 * The feedback loop that scoring learns from: it remembers which tags fired for an
 * event, then when a label lands on that event — analyst or chargeback — it credits
 * those tags. The learned weights it exposes are what the LearnedScorer reads in place
 * of hand weights.
 */
@Injectable()
export class ModelService implements ModelPort, OnModuleInit {
  private readonly samples: Collection<Sample>;
  private readonly models: Collection<ModelDoc>;
  private readonly lock = new Mutex();

  constructor(
    @Inject(STORE) store: Store,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {
    this.samples = store.collection<Sample>("scoring-samples");
    this.models = store.collection<ModelDoc>("scoring-model");
  }

  onModuleInit(): void {
    this.bus.subscribe<VerdictReachedPayload>(VERDICT_REACHED, async (e) => {
      await this.samples.put(e.payload.eventId, {
        tags: e.payload.reasons.map((r) => r.tag),
      });
    });
    // Serialized: the model doc is a single read-modify-write shared across all labels.
    this.bus.subscribe<LabelRecordedPayload>(LABEL_RECORDED, (e) =>
      this.lock.run(async () => {
        const sample = await this.samples.get(e.payload.eventId);
        if (!sample) return;
        const model = recordLabel(await this.load(), sample.tags, e.payload.outcome);
        await this.models.put(DOC, model);
        await this.samples.delete(e.payload.eventId);
      }),
    );
  }

  async weights(): Promise<TagWeight[]> {
    const model = await this.load();
    return Object.entries(model.tags)
      .map(([tag, c]) => toTagWeight(tag, c.fraud, c.legit))
      .sort((a, b) => b.weight - a.weight);
  }

  async weightFor(tag: string): Promise<TagWeight | null> {
    const c = (await this.load()).tags[tag];
    return c ? toTagWeight(tag, c.fraud, c.legit) : null;
  }

  private async load(): Promise<ModelDoc> {
    return (await this.models.get(DOC)) ?? emptyModel();
  }
}

function toTagWeight(tag: string, fraud: number, legit: number): TagWeight {
  const { weight, trusted } = weightOf({ fraud, legit });
  return { tag, fraud, legit, weight, trusted };
}
