import client, { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";
import { query, getPoolStats } from "../db/client";

// 1. Prometheus Metrics Registry
export const registry = new Registry();

// Collect Node.js process and runtime metrics for Kubernetes / Grafana
collectDefaultMetrics({ register: registry, prefix: "orchestrator_node_" });

// --- Turn & Session Metrics ---
export const turnsTotal = new Counter({
  name: "orchestrator_turns_total",
  help: "Total number of ephemeral agent turns executed",
  labelNames: ["tenant_id", "model", "status"],
  registers: [registry],
});

export const turnDurationSeconds = new Histogram({
  name: "orchestrator_turn_duration_seconds",
  help: "Execution duration of agent turns in seconds",
  labelNames: ["tenant_id", "status"],
  buckets: [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

export const activeSessionsGauge = new Gauge({
  name: "orchestrator_active_sessions",
  help: "Currently executing concurrent sessions",
  labelNames: ["tenant_id"],
  registers: [registry],
});

// --- Ephemeral Sandbox Metrics ---
export const sandboxesProvisionedTotal = new Counter({
  name: "orchestrator_sandboxes_provisioned_total",
  help: "Total ephemeral sandboxes provisioned in tmpfs",
  registers: [registry],
});

export const sandboxesCleanedTotal = new Counter({
  name: "orchestrator_sandboxes_cleaned_total",
  help: "Total ephemeral sandboxes purged from tmpfs",
  registers: [registry],
});

// --- Token & Cost Economics Metrics ---
export const tokensTotal = new Counter({
  name: "orchestrator_tokens_total",
  help: "Total LLM tokens consumed across turns",
  labelNames: ["tenant_id", "model", "type"], // type: 'input' | 'output' | 'reasoning' | 'cache_read'
  registers: [registry],
});

export const costUsdTotal = new Counter({
  name: "orchestrator_cost_usd_total",
  help: "Total estimated LLM spend in USD",
  labelNames: ["tenant_id", "model"],
  registers: [registry],
});

// --- Human-in-the-Loop Interaction Metrics ---
export const interactionsTotal = new Counter({
  name: "orchestrator_interactions_total",
  help: "Total permission and approval requests emitted by agents",
  labelNames: ["tenant_id", "tool", "type"],
  registers: [registry],
});

export const interactionsResolvedTotal = new Counter({
  name: "orchestrator_interactions_resolved_total",
  help: "Total user approval decisions resolved",
  labelNames: ["tenant_id", "tool", "resolution"], // resolution: 'approved' | 'rejected'
  registers: [registry],
});

export const interactionDurationSeconds = new Histogram({
  name: "orchestrator_interaction_duration_seconds",
  help: "Time spent waiting for human-in-the-loop approval in seconds",
  labelNames: ["tenant_id", "tool"],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

// --- PostgreSQL Connection Pool Metrics ---
export const dbPoolTotalGauge = new Gauge({
  name: "orchestrator_db_pool_total",
  help: "Total active PostgreSQL connection pool clients",
  registers: [registry],
});

export const dbPoolIdleGauge = new Gauge({
  name: "orchestrator_db_pool_idle",
  help: "Idle PostgreSQL connection pool clients",
  registers: [registry],
});

export const dbPoolWaitingGauge = new Gauge({
  name: "orchestrator_db_pool_waiting",
  help: "Queued requests waiting for a PostgreSQL connection",
  registers: [registry],
});

export function updateDbPoolMetrics(): void {
  const stats = getPoolStats();
  dbPoolTotalGauge.set(stats.totalCount);
  dbPoolIdleGauge.set(stats.idleCount);
  dbPoolWaitingGauge.set(stats.waitingCount);
}

// 2. Database Metric Record Interface
export interface TelemetryRecord {
  id?: number;
  sessionId?: string;
  tenantId?: string;
  metricType: "turn" | "token" | "tool" | "interaction" | "sandbox";
  metricName: string;
  metricValue: number;
  labels?: Record<string, any>;
  createdAt?: string;
}

/**
 * Persists an operational metric event into PostgreSQL orchestrator_telemetry table.
 * Asynchronous and fail-safe (never blocks or fails the parent turn).
 */
export async function recordMetricToDb(
  metricType: TelemetryRecord["metricType"],
  metricName: string,
  metricValue: number,
  labels: Record<string, any> = {},
  sessionId?: string,
  tenantId?: string
): Promise<void> {
  try {
    await query(
      `INSERT INTO orchestrator_telemetry (session_id, tenant_id, metric_type, metric_name, metric_value, labels)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId || null,
        tenantId || "default_tenant",
        metricType,
        metricName,
        metricValue,
        JSON.stringify(labels),
      ]
    );
  } catch {
    // Graceful degradation when DB is offline or in isolated unit tests
  }
}

/**
 * Queries recent aggregated telemetry from PostgreSQL for dashboards & diagnostics.
 */
export async function getTelemetrySummary(limit: number = 100): Promise<TelemetryRecord[]> {
  try {
    const res = await query<TelemetryRecord>(
      `SELECT 
         id, 
         session_id AS "sessionId", 
         tenant_id AS "tenantId", 
         metric_type AS "metricType", 
         metric_name AS "metricName", 
         metric_value AS "metricValue", 
         labels, 
         created_at AS "createdAt"
       FROM orchestrator_telemetry
       ORDER BY id DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  } catch {
    return [];
  }
}
