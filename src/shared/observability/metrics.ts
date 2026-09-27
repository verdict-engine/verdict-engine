/**
 * A tiny, dependency-free metrics registry rendered in Prometheus text format at GET /metrics.
 * Counters, gauges and histograms cover the operational signals we care about without pulling in
 * prom-client. Metric instances are module-level singletons — metrics are cross-cutting, so
 * instrumentation imports the specific instance it needs rather than threading a service through DI.
 */
type Labels = Record<string, string>;

function seriesKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(",");
}

function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const escape = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
  return `{${keys.map((k) => `${k}="${escape(labels[k])}"`).join(",")}}`;
}

interface Metric {
  render(): string;
}

class Counter implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, n = 1): void {
    const key = seriesKey(labels);
    const s = this.series.get(key) ?? { labels, value: 0 };
    s.value += n;
    this.series.set(key, s);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.series.size === 0) lines.push(`${this.name} 0`);
    for (const s of this.series.values()) lines.push(`${this.name}${renderLabels(s.labels)} ${s.value}`);
    return lines.join("\n");
  }
}

class Gauge implements Metric {
  private readonly series = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  set(value: number, labels: Labels = {}): void {
    this.series.set(seriesKey(labels), { labels, value });
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.series.size === 0) lines.push(`${this.name} 0`);
    for (const s of this.series.values()) lines.push(`${this.name}${renderLabels(s.labels)} ${s.value}`);
    return lines.join("\n");
  }
}

class Histogram implements Metric {
  private readonly series = new Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly bounds: number[],
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = seriesKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { labels, buckets: new Array(this.bounds.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    for (let i = 0; i < this.bounds.length; i++) if (value <= this.bounds[i]) s.buckets[i]++;
    s.sum += value;
    s.count++;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const s of this.series.values()) {
      for (let i = 0; i < this.bounds.length; i++) {
        lines.push(`${this.name}_bucket${renderLabels({ ...s.labels, le: String(this.bounds[i]) })} ${s.buckets[i]}`);
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...s.labels, le: "+Inf" })} ${s.count}`);
      lines.push(`${this.name}_sum${renderLabels(s.labels)} ${s.sum}`);
      lines.push(`${this.name}_count${renderLabels(s.labels)} ${s.count}`);
    }
    return lines.join("\n");
  }
}

class Registry {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    const c = new Counter(name, help);
    this.metrics.push(c);
    return c;
  }

  gauge(name: string, help: string): Gauge {
    const g = new Gauge(name, help);
    this.metrics.push(g);
    return g;
  }

  histogram(name: string, help: string, bounds: number[]): Histogram {
    const h = new Histogram(name, help, bounds);
    this.metrics.push(h);
    return h;
  }

  render(): string {
    return `${this.metrics.map((m) => m.render()).join("\n\n")}\n`;
  }
}

export const registry = new Registry();

// The operational signals exposed at /metrics.
export const decisionDuration = registry.histogram(
  "verdict_decision_duration_ms",
  "End-to-end decision latency in milliseconds",
  [5, 10, 20, 50, 100, 200, 500, 1000, 2000],
);
export const decisionsTotal = registry.counter("verdict_decisions_total", "Decisions returned, by verdict");
export const degradedTotal = registry.counter("verdict_degraded_total", "Decisions served from the fail-open/closed path");
export const rateLimitedTotal = registry.counter("verdict_rate_limited_total", "Requests rejected with 429, by bucket");
export const outboxDeliveredTotal = registry.counter("verdict_outbox_delivered_total", "Outbox events published to the bus");
export const outboxFailedTotal = registry.counter("verdict_outbox_failed_total", "Outbox delivery attempts that failed");
export const outboxDeadLetteredTotal = registry.counter("verdict_outbox_dead_lettered_total", "Outbox events moved to the dead-letter");
export const outboxPending = registry.gauge("verdict_outbox_pending", "Outbox rows awaiting delivery (sampled each drain)");
export const webhookDeliveredTotal = registry.counter("verdict_webhook_delivered_total", "Webhook deliveries that succeeded");
export const webhookFailedTotal = registry.counter("verdict_webhook_failed_total", "Webhook delivery attempts that failed");
export const webhookDeadLetteredTotal = registry.counter("verdict_webhook_dead_lettered_total", "Webhook deliveries moved to the dead-letter");
export const webhookPending = registry.gauge("verdict_webhook_pending", "Webhook deliveries awaiting delivery (sampled each drain)");
export const notificationDeliveredTotal = registry.counter("verdict_notification_delivered_total", "Alert notifications delivered, by event");
export const notificationFailedTotal = registry.counter("verdict_notification_failed_total", "Alert notifications that failed to deliver, by event");
export const notificationDeadLetteredTotal = registry.counter("verdict_notification_dead_lettered_total", "Alert notifications moved to the dead-letter, by event");
export const notificationThrottledTotal = registry.counter("verdict_notification_throttled_total", "Alerts dropped by a channel's per-minute throttle, by event");
export const notificationPending = registry.gauge("verdict_notification_pending", "Alert deliveries awaiting delivery (sampled each drain)");
export const retentionPrunedTotal = registry.counter("verdict_retention_pruned_total", "Records deleted by the retention prune job, by collection");
export const retentionLastRunSeconds = registry.gauge("verdict_retention_last_run_timestamp_seconds", "Unix time of the last completed retention sweep");
export const modelReloadTotal = registry.counter("verdict_model_reload_total", "ML model (re)load attempts, by result (loaded/fallback)");
export const modelRemoteActive = registry.gauge("verdict_model_remote_active", "1 when the ML scorer is serving a remotely-loaded model, 0 when using the bundled weights");
export const storageBytes = registry.gauge("verdict_storage_bytes", "Total size on disk of the document store (sampled each retention sweep)");
export const storageRows = registry.gauge("verdict_storage_rows", "Row count in the document store, by collection (sampled each retention sweep)");
export const diskTotalBytes = registry.gauge("verdict_disk_total_bytes", "Total size of a monitored filesystem, by path (sampled each retention sweep)");
export const diskFreeBytes = registry.gauge("verdict_disk_free_bytes", "Space available to the engine on a monitored filesystem, by path (sampled each retention sweep)");
export const diskUsedRatio = registry.gauge("verdict_disk_used_ratio", "Used fraction (0..1) of a monitored filesystem, by path (sampled each retention sweep)");
export const diskComponentBytes = registry.gauge("verdict_disk_component_bytes", "Disk space consumed by each service/component, by component (sampled each retention sweep)");
