# OpenCode Ephemeral Orchestrator

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-AG--UI%20SSE-orange.svg)](#-ag-ui-protocol-mapping)

`opencode-orchestrator` is an enterprise-ready, multi-tenant, ephemeral orchestration engine and CLI for [OpenCode](https://github.com/opencode-ai/opencode). It provides stateless task execution inside isolated `tmpfs` sandboxes, persists session history and conversation memory in PostgreSQL, translates events in real time to the **AG-UI Protocol (SSE)**, and supports human-in-the-loop approvals via a bidirectional `stdio` RPC bridge.

---

## 🏛️ Architecture Design

```
┌─────────────────────────────────────────────────────────────┐
│                 Client Frontend / IDE                       │
│    (Renders AG-UI SSE Stream & Submits User Interactions)   │
└───────────────┬─────────────────────────────▲───────────────┘
  1. POST /turn │                             │ 3. AG-UI SSE Stream
  4. POST /interact                           │ (TEXT_MESSAGE_CONTENT,
                ▼                             │  STATE_DELTA, etc.)
┌─────────────────────────────────────────────┴───────────────┐
│              `opencode-orchestrator` Service                │
│  - Session Manager & Context Rehydrator                     │
│  - Ephemeral TMPFS Sandbox Provisioner                      │
│  - AG-UI Protocol Translator                                │
│  - Stdio RPC Bridge (Stdin Approvals / Stdout Parsing)      │
│  - PostgreSQL Client & Persistence Sync                     │
└───────────────┬─────────────────────────────▲───────────────┘
                │ Spawns isolated process     │ Reads stdout lines
                │ Writes to stdin             │
                ▼                             │
┌─────────────────────────────────────────────┴───────────────┐
│         Isolated Worker Sub-process (`opencode run`)        │
│  - HOME=/tmp/sandboxes/{session_id}/home (Ephemeral DB)     │
│  - WORKDIR=/tmp/sandboxes/{session_id}/workspace            │
│  - Dynamic Configuration: opencode.json + Skills            │
└─────────────────────────────────────────────────────────────┘
```

### Core Architecture Principles

* **Stateless Compute (`tmpfs` Isolation):** Every execution turn provisions a fresh directory at `/tmp/sandboxes/{sessionId}`. OpenCode writes its temporary SQLite database here; upon turn conclusion, the sandbox is purged (`rm -rf`).
* **Context Rehydration via PostgreSQL:** Before launching the process, the orchestrator queries PostgreSQL for the latest session summary and prior conversation turns, constructing structured context prefixes (`=== PREVIOUS SESSION SUMMARY ===`, `=== RECENT CONVERSATION HISTORY ===`, `=== CURRENT TASK ===`).
* **Declarative Extensions:** Agent skills (`SKILL.md`) and task configurations are dynamically generated in the sandbox environment immediately prior to process spawning.
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
git clone https://github.com/opencode-ai/opencode-orchestrator.git
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

Apply `schema.sql` to your PostgreSQL database:

```bash
# Using CLI
npm run cli -- migrate

# Or with psql
psql $DATABASE_URL -f schema.sql
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

# 2. Run with AG-UI SSE stream output
npx opencode-orchestrator run "Say hello" -m openrouter/deepseek/deepseek-v4-flash --format sse

# 3. Start the HTTP & SSE Server
npx opencode-orchestrator serve -p 8080

# 4. Check database & binary health
npx opencode-orchestrator health

# 5. Apply PostgreSQL migrations
npx opencode-orchestrator migrate
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
- `GET /health`: Health check endpoint

---

## 🧪 Testing & Verification

```bash
# Run all test suites (unit, integration, and live OpenCode execution)
npm test
```

### Test Suite Structure

* **`tests/unit/cli.test.ts`**: Validates CLI commands, flags, and options.
* **`tests/unit/sandbox.test.ts`**: Verifies ephemeral sandbox provisioning, skill injection, and purge lifecycle.
* **`tests/unit/aguiAdapter.test.ts`**: Tests protocol translation for tokens, plans, tool calls, and permissions.
* **`tests/unit/sessionStore.test.ts`**: Tests context rehydration and summary formatting.
* **`tests/integration/api.test.ts`**: Validates Express API endpoints.
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

Apache License 2.0. See [LICENSE](LICENSE) for details.
