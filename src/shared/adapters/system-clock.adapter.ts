import { Injectable } from "@nestjs/common";
import type { Clock } from "../ports/clock.port";

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  isoNow(): string {
    return new Date().toISOString();
  }
}
