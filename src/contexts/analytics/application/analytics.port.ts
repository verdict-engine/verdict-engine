import type { AnalyticsSummary } from "../domain/summary";

export interface AnalyticsView extends AnalyticsSummary {
  falsePositiveRate: number;
}

export interface AnalyticsPort {
  summary(): Promise<AnalyticsView>;
}

export const ANALYTICS_PORT = Symbol("AnalyticsPort");
