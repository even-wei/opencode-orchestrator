import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";

dotenv.config();

export interface AppConfig {
  port: number;
  host: string;
  databaseUrl?: string;
  pg: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean;
  };
  sandboxBaseDir: string;
  opencodeBinPath: string;
  defaultContextTurns: number;
  processTimeoutMs: number;
  interactionTimeoutMs: number;
  telemetry: {
    enabled: boolean;
    endpoint: string;
    serviceName: string;
  };
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || "8080", 10),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL,
  pg: {
    host: process.env.PGHOST || "localhost",
    port: parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "opencode",
    ssl: process.env.PGSSL === "true",
  },
  sandboxBaseDir: process.env.SANDBOX_BASE_DIR || path.join(os.tmpdir(), "sandboxes"),
  opencodeBinPath: process.env.OPENCODE_BIN_PATH || "opencode",
  defaultContextTurns: parseInt(process.env.DEFAULT_CONTEXT_TURNS || "10", 10),
  processTimeoutMs: parseInt(process.env.PROCESS_TIMEOUT_MS || "300000", 10),
  interactionTimeoutMs: parseInt(process.env.INTERACTION_TIMEOUT_MS || "300000", 10),
  telemetry: {
    enabled: process.env.PHOENIX_ENABLED === "true" || process.env.OTEL_ENABLED === "true",
    endpoint:
      process.env.PHOENIX_COLLECTOR_URL ||
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      "http://localhost:4318/v1/traces",
    serviceName: process.env.OTEL_SERVICE_NAME || "opencode-orchestrator",
  },
};
