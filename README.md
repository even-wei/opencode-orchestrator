# OpenCode Ephemeral Orchestrator

`opencode-orchestrator` is a multi-tenant, ephemeral execution engine for OpenCode CLI. It enables stateless, disposable agent task execution, maintains persistent session state and conversation memory in PostgreSQL, streams real-time events via the **AG-UI Protocol (SSE)**, and provides human-in-the-loop interactions through a bidirectional `stdio` bridge.

---

## 🏛️ Architecture Overview

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

### Core Principles

1. **Stateless Compute (`tmpfs` Isolation):** Each turn provisions an isolated directory at `/tmp/sandboxes/{sessionId}`. OpenCode writes its temporary SQLite database here; upon turn completion, the directory is purged immediately.
2. **Context Rehydration:** On task turn start, the orchestrator pulls the latest session summary and previous message turns from PostgreSQL, composing a structured context prefix before calling the CLI.
3. **Declarative Extensions:** Agent skills (`SKILL.md`) and config are injected dynamically into the sandbox environment prior to spawning the process.
4. **AG-UI Protocol Streaming:** OpenCode stdout JSON events are mapped to AG-UI SSE events in real time.
5. **Bidirectional Stdio RPC Bridge:** Permission checks pause the sub-process and emit `INTERACTION_REQUEST` over SSE. Resolving the interaction via HTTP POST writes the decision payload directly into `stdin`.

---

## 📡 AG-UI Protocol Mapping

| OpenCode Raw Event | AG-UI SSE Event | Description |
| :--- | :--- | :--- |
| `token` | `MESSAGE_START` / `TEXT_MESSAGE_CONTENT` | Assistant response token stream |
| `plan_update` | `STATE_DELTA` (`path: "/todos"`) | Progress plan and checklist updates |
| `tool_start` | `TOOL_CALL_START` | Sub-agent or tool execution triggered |
| `tool_finish` | `TOOL_CALL_RESULT` | Tool completion output & status |
| `permission_request`| `INTERACTION_REQUEST` | Approval request halting execution |
| `session_compacted` | `STATE_DELTA` (`path: "/summary"`) | Updated compacted memory summary |
| `done` | `MESSAGE_END` + `RUN_FINISHED` | Completion status and stream termination |

---

## 🚀 Quickstart

### 1. Installation

```bash
npm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and set your PostgreSQL connection details:

```bash
cp .env.example .env
```

### 3. Database Schema Migration

Apply `schema.sql` to your PostgreSQL database:

```bash
psql $DATABASE_URL -f schema.sql
```

### 4. Build & Run

```bash
# Build TypeScript
npm run build

# Start Production Server
npm start

# Or start in Development mode with tsx
npm run dev
```

---

## 🧪 Verification & Testing

Run unit and integration test suites:

```bash
npm run test
```

### Test Coverage

* **`tests/unit/sandbox.test.ts`**: Verifies ephemeral folder provisioning, dynamic skill injection, and complete cleanup.
* **`tests/unit/aguiAdapter.test.ts`**: Validates mapping from OpenCode JSON events to AG-UI SSE events.
* **`tests/unit/sessionStore.test.ts`**: Tests context rehydration and summary formatting.
* **`tests/integration/interactionFlow.test.ts`**: Validates stdio pause, resume, and human-in-the-loop approvals.
* **`tests/integration/turnStreamE2E.test.ts`**: Full end-to-end SSE turn execution and HTTP interaction resolution.

---

## 🌐 API Reference

### 1. Initiate Turn & Open AG-UI SSE Stream
`POST /api/v1/sessions/:id/stream` or `POST /api/v1/sessions/:id/turn`

**Request Body:**
```json
{
  "tenantId": "tenant_101",
  "prompt": "Create a database migration for users table",
  "taskConfig": {
    "model": "anthropic/claude-3-5-sonnet"
  },
  "skills": [
    {
      "name": "db-migrate",
      "content": "# Database Migration Skill Guide..."
    }
  ]
}
```

**Response:** `text/event-stream` (AG-UI SSE protocol)

---

### 2. Resolve User Approval / Interaction
`POST /api/v1/sessions/:id/interactions`

**Request Body:**
```json
{
  "interactionId": "act_101",
  "resolution": "approved",
  "data": {
    "selectedOption": "approve",
    "feedback": "Execution verified"
  }
}
```

**Response:**
```json
{
  "status": "acknowledged",
  "interactionId": "act_101"
}
```

---

### 3. Session & Tenant Management
- `POST /api/v1/tenants`: Create/ensure tenant
- `POST /api/v1/sessions`: Create new session
- `GET /api/v1/sessions/:id`: Get session metadata & status
- `GET /api/v1/sessions/:id/events`: Get session event history
- `GET /health`: Health check
