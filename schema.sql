-- schema.sql: PostgreSQL schema for OpenCode Ephemeral Orchestrator

CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE CASCADE,
    title VARCHAR(255),
    status VARCHAR(32) DEFAULT 'idle',
    latest_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_events (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(64) REFERENCES sessions(id) ON DELETE CASCADE,
    turn_index INT NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_events_session ON chat_events(session_id, turn_index);

CREATE TABLE IF NOT EXISTS orchestrator_telemetry (
    id BIGSERIAL PRIMARY KEY,
    session_id VARCHAR(64),
    tenant_id VARCHAR(64),
    metric_type VARCHAR(64) NOT NULL,
    metric_name VARCHAR(128) NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    labels JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_telemetry_created ON orchestrator_telemetry(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_tenant_session ON orchestrator_telemetry(tenant_id, session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_metric ON orchestrator_telemetry(metric_name);

