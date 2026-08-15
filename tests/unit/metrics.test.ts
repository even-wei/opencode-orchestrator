import { test, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/index";
import {
  registry,
  turnsTotal,
  activeSessionsGauge,
  tokensTotal,
  costUsdTotal,
  recordMetricToDb,
  getTelemetrySummary,
} from "../../src/observability/metrics";

test("GET /metrics returns Prometheus exposition format", async () => {
  const res = await request(app).get("/metrics");
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("text/plain");
  expect(res.text).toContain("orchestrator_turns_total");
  expect(res.text).toContain("orchestrator_active_sessions");
  expect(res.text).toContain("orchestrator_sandboxes_provisioned_total");
});

test("Prometheus counters and gauges increment properly", async () => {
  turnsTotal.inc({ tenant_id: "test_tenant", model: "deepseek", status: "completed" });
  activeSessionsGauge.inc({ tenant_id: "test_tenant" });
  tokensTotal.inc({ tenant_id: "test_tenant", model: "deepseek", type: "input" }, 150);
  costUsdTotal.inc({ tenant_id: "test_tenant", model: "deepseek" }, 0.005);

  const metricsText = await registry.metrics();
  expect(metricsText).toContain('orchestrator_turns_total{tenant_id="test_tenant",model="deepseek",status="completed"} 1');
  expect(metricsText).toContain('orchestrator_active_sessions{tenant_id="test_tenant"} 1');
  expect(metricsText).toContain('orchestrator_tokens_total{tenant_id="test_tenant",model="deepseek",type="input"} 150');
  expect(metricsText).toContain('orchestrator_cost_usd_total{tenant_id="test_tenant",model="deepseek"} 0.005');

  activeSessionsGauge.dec({ tenant_id: "test_tenant" });
});

test("PostgreSQL telemetry persistence and query functions", async () => {
  await recordMetricToDb(
    "turn",
    "turn_test_metric",
    1,
    { status: "completed" },
    "sess_metric_test",
    "tenant_metric_test"
  );

  const res = await request(app).get("/api/v1/telemetry?limit=5");
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("count");
  expect(Array.isArray(res.body.telemetry)).toBe(true);
});
