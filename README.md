# OpenCode Ephemeral Orchestrator

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-AG--UI%20SSE-orange.svg)](#-ag-ui-protocol-mapping)

`opencode-orchestrator` is an enterprise-ready, multi-tenant, ephemeral orchestration engine and CLI for [OpenCode](https://github.com/opencode-ai/opencode). It provides stateless task execution inside isolated `tmpfs` sandboxes, persists session history and conversation memory in PostgreSQL, translates events in real time to the **AG-UI Protocol (SSE)**, and supports human-in-the-loop approvals via a bidirectional `stdio` RPC bridge.

---

## 🏛️ Architecture Design

<p align="center">
  <img src="assets/architecture.png" alt="OpenCode Ephemeral Orchestrator Architecture" width="100%">
</p>

### Core Architectural Principles

* **Stateless Compute (`tmpfs` Isolation):** Every execution turn provisions a fresh directory at `/tmp/sandboxes/{sessionId}`. OpenCode writes its temporary SQLite database here; upon turn conclusion, the sandbox is purged (`rm -rf`).
* **Context Rehydration via PostgreSQL:** Before launching the process, the orchestrator queries PostgreSQL for the latest session summary and prior conversation turns, constructing structured context prefixes (`=== PREVIOUS SESSION SUMMARY ===`, `=== RECENT CONVERSATION HISTORY ===`, `=== CURRENT TASK ===`).
* **Declarative Skills & MCP Integration:** Dynamic agent skills (`SKILL.md`) and Model Context Protocol (`taskConfig.mcp`) servers are automatically provisioned in the sandbox environment immediately prior to process spawning.
* **AG-UI Protocol Streaming:** OpenCode stdout JSON events are mapped to AG-UI SSE events in real time.
* **Bidirectional Interaction (Stdio Bridge):** Permission requests trigger an `INTERACTION_REQUEST` event over SSE and suspend the sub-process. User decisions via `POST /api/v1/sessions/:id/interactions` are written directly into `stdin` to resume execution.

---

## 📡 AG-UI Protocol Mapping

| OpenCode Raw Event | AG-UI SSE Event | Description |
| :--- | :--- | :--- |
| `token` / `text` | `MESSAGE_START` / `TEXT_MESSAGE_CONTENT` | Assistant response token stream |
| `plan_update` | `STATE_DELTA` (`path: "/todos"`) | Progress plan and checklist updates |
| `step_finish` | `STATE_DELTA` (`path: "/metrics"`) | Token usage and cost metrics |
| `tool_start` / `tool_use` | `TOOL_CALL_START` | Tool execution triggered |
| `tool_finish` / `tool_use` | `TOOL_CALL_RESULT` | Tool completion output & status |
| `permission_request` / `permission` | `INTERACTION_REQUEST` | Approval request halting execution |
| `session_compacted` | `STATE_DELTA` (`path: "/summary"`) | Updated compacted memory summary |
| `done` | `MESSAGE_END` + `RUN_FINISHED` | Completion status and stream termination |

---

## 🚀 Getting Started

### 1. Installation

```bash
# Clone repository
git clone https://github.com/even-wei/opencode-orchestrator.git
cd opencode-orchestrator

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### 2. Configuration

Copy `.env.example` to `.env` and set your PostgreSQL and timeout configurations:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | Port for the HTTP & SSE server |
| `HOST` | `0.0.0.0` | Host interface to bind |
| `DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `SANDBOX_BASE_DIR` | `/tmp/sandboxes` | Base directory for ephemeral execution |
| `OPENCODE_BIN_PATH`| `opencode` | Path to the OpenCode CLI executable |
| `DEFAULT_CONTEXT_TURNS` | `10` | Number of previous turns to rehydrate |
| `PROCESS_TIMEOUT_MS` | `300000` | Process execution timeout (ms) |
| `INTERACTION_TIMEOUT_MS` | `300000` | Pending approval timeout (ms) |

### 3. Database Migration

Spin up PostgreSQL (or use Docker) and apply `schema.sql`:

```bash
# Spin up PostgreSQL in Docker
docker run -d --name opencode-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=opencode postgres:16

# Apply migrations using CLI
npm run cli -- migrate
```

### 4. Running the Service

```bash
# Production server
npm start

# Development mode with tsx
npm run dev
```

---

## ⌨️ Command-Line Interface (CLI)

`opencode-orchestrator` can also be used as a standalone CLI tool:

```bash
# Show CLI Help
npx opencode-orchestrator --help

# 1. Execute a one-off ephemeral turn directly from terminal
npx opencode-orchestrator run "Write a quicksort in Python" -m openrouter/deepseek/deepseek-v4-flash

# 2. Run with a published agent from the team registry
npx opencode-orchestrator run --agent db-analyzer "Inspect active table indexes"

# 3. Run with AG-UI SSE stream output
npx opencode-orchestrator run "Say hello" -m openrouter/deepseek/deepseek-v4-flash --format sse

# 4. Interactive Agent Genesis Wizard (Create, Test, Iterate, Publish)
npx opencode-orchestrator agent init
npx opencode-orchestrator agent test my-agent.agent.json
npx opencode-orchestrator agent iterate my-agent.agent.json --feedback "Add LIMIT 20 to queries"
npx opencode-orchestrator agent publish my-agent.agent.json
npx opencode-orchestrator agent list

# 5. Start the HTTP & SSE Server
npx opencode-orchestrator serve -p 8080

# 6. Run automated system verification (DB, CLI, Sandbox, Skills, OTel)
npx opencode-orchestrator verify

# 7. Run live end-to-end turn verification with LLM
npx opencode-orchestrator verify --live -m openrouter/deepseek/deepseek-v4-flash

# 8. Apply PostgreSQL migrations
npx opencode-orchestrator migrate

# 9. Check database & binary health
npx opencode-orchestrator health
```

---

## 🌐 REST & SSE API Reference

### 1. Initiate Turn & Open AG-UI SSE Stream
`POST /api/v1/sessions/:id/stream` or `POST /api/v1/sessions/:id/turn` (also supports `GET /api/v1/sessions/:id/stream`)

**Request Body:**
```json
{
  "tenantId": "tenant_101",
  "model": "openrouter/deepseek/deepseek-v4-flash",
  "prompt": "Create a database migration for the users table",
  "taskConfig": {
    "model": "openrouter/deepseek/deepseek-v4-flash"
  },
  "skills": [
    {
      "name": "db-migrate",
      "content": "# Database Migration Guide\nUse knex migrations."
    }
  ]
}
```

**Response:** `text/event-stream` (AG-UI SSE stream)

```http
event: MESSAGE_START
data: {"messageId":"msg_101","role":"assistant","runId":"run_1786789041"}

event: TEXT_MESSAGE_CONTENT
data: {"messageId":"msg_101","delta":"I will create the migration file."}

event: TOOL_CALL_START
data: {"callId":"call_1","tool":"bash","params":{"command":"touch migration.sql"}}

event: TOOL_CALL_RESULT
data: {"callId":"call_1","result":"File created","isError":false}

event: STATE_DELTA
data: {"path":"/metrics","op":"replace","value":{"tokens":{"total":1200,"input":1100,"output":100},"cost":0.0001}}

event: MESSAGE_END
data: {"messageId":"msg_101"}

event: RUN_FINISHED
data: {"runId":"run_1786789041","status":"completed","exitCode":0}
```

---

### 2. Resolve User Approval / Interaction
`POST /api/v1/sessions/:id/interactions`

**Request Body:**
```json
{
  "interactionId": "perm_101",
  "resolution": "approved",
  "data": {
    "selectedOption": "approve",
    "feedback": "Deployment approved for staging"
  }
}
```

**Response:**
```json
{
  "status": "acknowledged",
  "interactionId": "perm_101"
}
```

---

### 3. Session & Tenant Management Endpoints
- `POST /api/v1/tenants`: Create/ensure tenant
- `POST /api/v1/sessions`: Create new session
- `GET /api/v1/sessions/:id`: Get session metadata & status
- `GET /api/v1/sessions/:id/events`: Get session event history
- `GET /health` or `GET /api/v1/health`: Health check endpoint
- `GET /livez`: Kubernetes liveness probe
- `GET /readyz`: Kubernetes readiness probe (PostgreSQL verified)

---

## 🏭 Agent Genesis & Continuous Iteration Engine

`opencode-orchestrator` features a built-in **Meta-Agent Factory** that allows any team member to design, test, iterate, and publish production-grade AI agents in under 3 minutes.

### 1. Interactive Agent Creation (CLI Wizard)
```bash
npx opencode-orchestrator agent init
```
* Scans local repository schemas (`package.json`, `schema.sql`, `Dockerfile`).
* Selects matching Verified MCPs (`postgres`, `github`, `slack`, `fetch`) and Curated Skills (`db-analyzer`, `git-release`, `pr-reviewer`).
* Synthesizes and lints `SKILL.md` rules and generates benchmark test cases in `./<agent-name>.agent.json`.

### 2. Benchmark Simulation & Sandbox Testing
```bash
npx opencode-orchestrator agent test my-agent.agent.json
```
Runs the agent's `evalSuite` in disposable ephemeral sandboxes and asserts deterministic post-conditions (`file_exists`, `output_contains`, `expected_tool_called`).

### 3. Diff-Driven Iterative Steering
```bash
npx opencode-orchestrator agent iterate my-agent.agent.json --feedback "Never drop tables without confirmation"
```
Proposes a visual Git-style Red/Green diff for `SKILL.md`, bumps the semantic patch version, and prompts for confirmation.

### 4. Publish to Team Registry
```bash
npx opencode-orchestrator agent publish my-agent.agent.json
```

### 5. Execute Registered Agent Directly
```bash
# Any teammate can now invoke the published agent:
npx opencode-orchestrator run --agent my-agent "Triage open customer issues"
```

### 6. Agent Factory REST Endpoints
* `GET /api/v1/catalog/mcp`: List verified Model Context Protocol tools.
* `GET /api/v1/catalog/skills`: List curated operational skills library.
* `POST /api/v1/agents/synthesize`: Synthesize `AgentBundle` from description/repo scan.
* `POST /api/v1/agents/refine`: Diff-driven iterative steering.
* `POST /api/v1/agents/publish`: Save agent bundle to PostgreSQL registry.
* `GET /api/v1/agents`: List team agent catalog with trust telemetry.
* `GET /api/v1/agents/:name`: Fetch specific agent bundle.

---

---

## 🧩 Skills & MCP Configuration Guide

`opencode-orchestrator` allows injecting declarative skills (`SKILL.md`) and Model Context Protocol (MCP) servers dynamically into each ephemeral execution turn.

### 1. Declarative Skills

Skills are markdown instructions with YAML frontmatter placed in `.opencode/skills/<skill-name>/SKILL.md`:

```markdown
---
name: db-analyzer
description: Inspects database schemas, indexes, and queries using PostgreSQL MCP tools
---

# PostgreSQL Database Analyzer Skill
1. Use `postgres-mcp` tools to inspect `information_schema.tables`.
2. Check foreign key relationships and index coverage.
3. Recommend composite indexes for slow queries.
```

### 2. Model Context Protocol (MCP) Servers

MCP servers are configured in `taskConfig.mcp` (injected into `$HOME/.config/opencode/opencode.json`):

```json
{
  "taskConfig": {
    "model": "openrouter/deepseek/deepseek-v4-flash",
    "mcp": {
      "postgres": {
        "type": "local",
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-postgres",
          "postgresql://postgres:postgres@localhost:5432/opencode"
        ],
        "enabled": true
      },
      "filesystem": {
        "type": "local",
        "command": "npx",
        "args": [
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "/tmp/sandboxes"
        ],
        "enabled": true
      },
      "remote-mcp": {
        "type": "remote",
        "url": "https://mcp.internal.company.com/sse",
        "enabled": true
      }
    }
  }
}
```

> **Note:** If `type` or `enabled` are omitted, `opencode-orchestrator` automatically normalizes `type` to `"local"` (or `"remote"`) and sets `enabled: true`.

### 3. Example Turn Script

Run a complete turn with skills and MCP using TypeScript:

```bash
npx tsx examples/run_turn.ts
```

---

## 🔭 Self-Hosted Observability & Tracing (Arize Phoenix)

`opencode-orchestrator` features native, zero-overhead **OpenTelemetry (OTel)** tracing compliant with the **OpenInference** standard. You can visualize tool execution Gantt charts, model latencies, token consumption, and human-in-the-loop pauses using self-hosted [Arize Phoenix](https://github.com/Arize-ai/phoenix).

### 1. Self-Hosted Stack with Docker Compose

Spin up PostgreSQL, Arize Phoenix, and OpenCode Orchestrator in a single command:

```bash
docker compose up -d
```

- **Orchestrator API:** `http://localhost:8080`
- **Arize Phoenix Web UI:** `http://localhost:6006`
- **Phoenix OTLP Collector:** `http://localhost:6006/v1/traces`
- **PostgreSQL Database:** `localhost:5432`

### 2. Environment Configuration

Add the following to your `.env`:

```env
PHOENIX_ENABLED=true
PHOENIX_COLLECTOR_URL=http://localhost:6006/v1/traces
OTEL_SERVICE_NAME=opencode-orchestrator
```

### 3. What Gets Traced
- **Root Turn Span (`CHAIN`):** Model, session ID, tenant ID (`user.id`), prompt, total duration, and exit status.
- **Tool Execution Spans (`TOOL`):** Tool name (`bash`, `read`, `glob`, MCP database tools), inputs, outputs, execution duration, and error states.
- **Token & Cost Metrics:** Input tokens, output tokens, reasoning tokens, cache hit rate, and total USD cost per turn.
- **Human-in-the-Loop Spans (`APPROVAL`):** Time spent waiting for user permission and the final decision (`approved` / `rejected`).

---

## 📈 Tool & Service Telemetry (Kubernetes & Grafana Ready)

`opencode-orchestrator` natively emits operational and economic telemetry at both the **Prometheus infrastructure level** and the **PostgreSQL relational level**:

### 1. Prometheus Scrape Endpoint (`/metrics`)
The server exposes a standard Prometheus exposition endpoint at `GET /metrics` for scraping by Prometheus, VictoriaMetrics, or Kubernetes Prometheus Operator:

```bash
curl http://localhost:8080/metrics
```

**Exported Metrics:**
| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `orchestrator_turns_total` | Counter | Total turns executed labeled by `tenant_id`, `model`, and `status` (`completed\|failed`) |
| `orchestrator_turn_duration_seconds` | Histogram | Turn execution latency percentiles (P50, P90, P99) |
| `orchestrator_active_sessions` | Gauge | Number of in-flight turns currently running |
| `orchestrator_sandboxes_provisioned_total` | Counter | Total ephemeral TMPFS sandboxes created |
| `orchestrator_sandboxes_cleaned_total` | Counter | Total sandboxes purged on turn completion |
| `orchestrator_tokens_total` | Counter | Tokens consumed by `tenant_id`, `model`, and `type` (`input\|output\|reasoning`) |
| `orchestrator_cost_usd_total` | Counter | Estimated LLM spend in USD |
| `orchestrator_interactions_total` | Counter | Permission requests emitted by agents |
| `orchestrator_interactions_resolved_total` | Counter | Human approvals resolved (`approved\|rejected`) |
| `orchestrator_node_*` | Gauges/Counters | Node.js process CPU, RSS memory, event loop lag, and GC metrics |

### 2. Kubernetes Prometheus Annotations
Add to your Kubernetes Deployment for automatic discovery:

```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
    prometheus.io/path: "/metrics"
```

### 3. PostgreSQL Relational Telemetry (`/api/v1/telemetry`)
Operational metrics are automatically recorded in the `orchestrator_telemetry` table in PostgreSQL for historical auditing and SQL reporting:

```sql
SELECT 
    tenant_id, 
    metric_name, 
    count(*) as total_events, 
    sum(metric_value) as aggregate_value
FROM orchestrator_telemetry
GROUP BY tenant_id, metric_name;
```

You can also fetch recent events via REST API: `GET /api/v1/telemetry?limit=50`.

### 4. Turnkey Grafana Dashboard
A plug-and-play Grafana dashboard is provided in [`dashboards/grafana-orchestrator.json`](dashboards/grafana-orchestrator.json). Simply import this JSON into Grafana to monitor active sessions, turn latencies, token consumption, and Human-in-the-Loop approval metrics.

---

## 📖 Client Integration & Call Preparation Manual

For an in-depth guide on how to prepare requests, structure payloads, inject dynamic MCP servers, declare agent skills, and handle streaming SSE events in TypeScript, Python, or cURL, consult the dedicated manual:

👉 **[Complete Turn Preparation & Configuration Manual (docs/CALL_PREPARATION_MANUAL.md)](docs/CALL_PREPARATION_MANUAL.md)**

### Quick Reference: Turn Request Payload

| Field | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `prompt` | `string` | **Yes** | The natural language task or prompt for this turn | `"List all database tables"` |
| `tenantId` / `userId` | `string` | No | Tenant or user ID for isolation and trace filtering | `"tenant_dev_101"` |
| `model` | `string` | No | Model identifier override | `"openrouter/deepseek/deepseek-v4-flash"` |
| `taskConfig` | `object` | No | Injected into `$HOME/.config/opencode/opencode.json` | `{"model": "...", "mcp": {...}}` |
| `taskConfig.mcp` | `object` | No | Model Context Protocol servers (local stdio or remote SSE) | See MCP guide below |
| `skills` | `array` | No | Declarative skills (`{ name, content }`) injected as `SKILL.md` | `[{"name": "db-analyzer", "content": "..."}]` |
| `auth` | `object` | No | Injected into `$HOME/.local/share/opencode/auth.json` | `{"openrouter": {"apiKey": "..."}}` |
| `binaryPath` | `string` | No | Custom path to the `opencode` binary if overriding default | `"/usr/local/bin/opencode"` |

---

## 🧪 Testing & Verification

```bash
# Run all test suites (unit, integration, and live OpenCode execution)
npm test
```

### Test Suite Structure

* **`tests/unit/agentFactory.test.ts`**: Verifies verified MCPs, curated skills, skill linter, synthesizer, and refiner diffs.
* **`tests/unit/metrics.test.ts`**: Tests Prometheus counters/gauges and PostgreSQL telemetry persistence.
* **`tests/unit/cli.test.ts`**: Validates CLI commands, flags, and options.
* **`tests/unit/sandbox.test.ts`**: Verifies ephemeral sandbox provisioning, skill injection, and purge lifecycle.
* **`tests/unit/skillsAndMcp.test.ts`**: Verifies MCP configuration normalization and skill injections.
* **`tests/unit/aguiAdapter.test.ts`**: Tests protocol translation for tokens, plans, tool calls, and permissions.
* **`tests/unit/sessionStore.test.ts`**: Tests context rehydration and summary formatting.
* **`tests/integration/agentApi.test.ts`**: Validates Agent Genesis REST endpoints (synthesize, refine, publish, list).
* **`tests/integration/api.test.ts`**: Validates Express API endpoints and Kubernetes probes (`/livez`, `/readyz`).
* **`tests/integration/interactionFlow.test.ts`**: Tests stdio pause, resume, and human-in-the-loop approvals.
* **`tests/integration/turnStreamE2E.test.ts`**: Full simulated E2E turn streaming and HTTP interaction resolution.
* **`tests/integration/realOpenCode.test.ts`**: Live execution with real OpenCode CLI and OpenRouter DeepSeek.

---

## 🚢 Kubernetes & Production Deployment

In Kubernetes, mount `/tmp/sandboxes` to a RAM-backed `emptyDir` (`medium: Memory`) for zero-disk-I/O execution:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opencode-orchestrator
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: orchestrator
          image: ghcr.io/opencode-ai/opencode-orchestrator:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: database-url
            - name: SANDBOX_BASE_DIR
              value: /tmp/sandboxes
          volumeMounts:
            - mountPath: /tmp/sandboxes
              name: sandbox-storage
      volumes:
        - name: sandbox-storage
          emptyDir:
            medium: Memory
            sizeLimit: 4Gi
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
