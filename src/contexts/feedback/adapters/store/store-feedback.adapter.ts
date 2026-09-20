import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import type { FeedbackPort, Label } from "../../application/feedback.port";

@Injectable()
export class StoreFeedback implements FeedbackPort {
  private readonly labels: Collection<Label>;

  constructor(@Inject(STORE) store: Store) {
    this.labels = store.collection<Label>("labels");
  }

  async record(label: Label): Promise<void> {
    await this.labels.put(randomUUID(), label);
  }

  async since(iso: string): Promise<Label[]> {
    return (await this.labels.all()).filter((l) => l.at >= iso);
  }
}
