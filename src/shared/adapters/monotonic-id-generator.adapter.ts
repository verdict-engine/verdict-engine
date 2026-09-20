import { Injectable } from "@nestjs/common";
import type { IdGenerator } from "../ports/id-generator.port";

/**
 * Default IdGenerator: lexically sortable enough for a log and dependency-free. Replace
 * with a ULID/KSUID adapter for stronger ordering — nothing that injects IdGenerator changes.
 */
@Injectable()
export class MonotonicIdGenerator implements IdGenerator {
  private lastMs = 0;
  private seq = 0;

  next(prefix: string): string {
    const now = Date.now();
    if (now === this.lastMs) {
      this.seq += 1;
    } else {
      this.lastMs = now;
      this.seq = 0;
    }
    const time = now.toString(36).padStart(9, "0");
    const seq = this.seq.toString(36).padStart(2, "0");
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${time}${seq}${rand}`;
  }
}
