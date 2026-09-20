import { describe, expect, it } from "vitest";
import { registry } from "./metrics";

describe("metrics registry", () => {
  it("renders counters, gauges and histograms in Prometheus text format", () => {
    const c = registry.counter("test_counter_total", "a test counter");
    const g = registry.gauge("test_gauge", "a test gauge");
    const h = registry.histogram("test_hist", "a test histogram", [10, 100]);

    c.inc({ verdict: "deny" });
    c.inc({ verdict: "deny" });
    c.inc({ verdict: "allow" });
    g.set(42);
    h.observe(5);
    h.observe(50);
    h.observe(500);

    const out = registry.render();

    expect(out).toContain("# TYPE test_counter_total counter");
    expect(out).toContain('test_counter_total{verdict="deny"} 2');
    expect(out).toContain('test_counter_total{verdict="allow"} 1');
    expect(out).toContain("# TYPE test_gauge gauge");
    expect(out).toContain("test_gauge 42");
    expect(out).toContain("# TYPE test_hist histogram");
    // 1 observation <= 10, 2 <= 100, 3 total.
    expect(out).toContain('test_hist_bucket{le="10"} 1');
    expect(out).toContain('test_hist_bucket{le="100"} 2');
    expect(out).toContain('test_hist_bucket{le="+Inf"} 3');
    expect(out).toContain("test_hist_count 3");
    expect(out).toContain("test_hist_sum 555");
  });
});
