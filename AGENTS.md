# AGENTS.md - Agent & Developer Operating Manual

Welcome to the `opencode-orchestrator` repository. This document provides technical context, architecture principles, repository navigation guidelines, development commands, and testing procedures for AI coding agents and engineers collaborating on this codebase.

---

## 1. System Mission & Architecture Topology

`opencode-orchestrator` is a multi-tenant, stateless execution engine for the [OpenCode](https://github.com/opencode-ai/opencode) CLI. It enables distributed, ephemeral task runs without persistent background OpenCode daemons.

```mermaid
flowchart TD
    subgraph ClientLayer["🖥️ Client / Frontend Layer"]
        IDE["Client Frontend / Web UI / IDE"]
    end

    subgraph Orchestrator["⚙️ OpenCode Ephemeral Orchestrator"]
        API["HTTP & SSE Controller<br/><code>/api/v1/sessions</code>"]
        Store["Context Rehydrator & Session Store"]
        Adapter["AG-UI Protocol Stream Adapter"]
        Registry["Stdio Interaction Registry<br/>(Human-in-the-Loop Bridge)"]
        SandboxMgr["Sandbox Lifecycle Manager<br/>(Provision & Purge)"]
    end

    subgraph Database["🐘 PostgreSQL (State of Record)"]
        PG[("PostgreSQL DB<br/>• tenants<br/>• sessions<br/>• chat_events & summaries")]
    end

    subgraph Sandbox["📦 Ephemeral Worker Sub-process (TMPFS)"]
        CLI["OpenCode Worker<br/><code>opencode run --pure</code>"]
        Home["HOME: /tmp/sandboxes/{id}/home<br/>(auth.json + opencode.json)"]
        Work["WORKDIR: /tmp/sandboxes/{id}/workspace<br/>(.opencode/skills/SKILL.md)"]
    end

    subgraph LLM["🧠 AI Provider"]
        OpenRouter["OpenRouter / DeepSeek / Claude / GPT"]
    end

    %% Client Interactions
    IDE -- "1. POST /api/v1/sessions/:id/stream" --> API
    API -- "3. AG-UI SSE Stream (Tokens, Tools, Deltas)" --> IDE
    IDE -- "4. POST /interactions (Approvals)" --> API

    %% Persistence & Context Rehydration
    API --> Store
    Store -- "Rehydrate context prefix" --> PG
    API -- "Persist events & summary" --> PG

    %% Sandbox Lifecycle & Stdio RPC Bridge
    API --> SandboxMgr
    SandboxMgr -- "Provision & Purge (rm -rf)" --> Home & Work
    API -- "Spawn process (stdio pipe)" --> CLI
    Registry -- "Write approval decision to stdin" --> CLI
    CLI -- "Stdout JSON lines" --> Adapter
    Adapter -- "Translate to AG-UI SSE" --> API

    %% AI Model Invocation
    CLI <--> OpenRouter
```

### Core Architectural Axioms

1. **Ephemeral Execution & TMPFS Isolation:**
   - Compute is disposable. Every turn executes in `/tmp/sandboxes/{sessionId}`.
   - OpenCode writes its local SQLite database and workspace artifacts here.
   - Upon turn conclusion or process termination, the sandbox is completely purged (`rm -rf`).

2. **PostgreSQL as Single Source of Truth:**
   - Session states, tenant mappings, chat events, and summaries are persisted in PostgreSQL.
   - Prior to process launch, state is rehydrated into structured prompt prefixes (`=== PREVIOUS SESSION SUMMARY ===`, `=== RECENT CONVERSATION HISTORY ===`, `=== CURRENT TASK ===`).

3. **AG-UI Protocol Alignment:**
   - Raw OpenCode stdout events (JSON lines) are translated into Server-Sent Events (SSE) following the standard AG-UI Protocol.

4. **Bidirectional Stdio RPC Bridge:**
   - When OpenCode requires permission or user confirmation, execution is suspended and an `INTERACTION_REQUEST` event is emitted.
   - Decisions submitted via `POST /api/v1/sessions/:id/interactions` are written directly into the sub-process's `stdin`.

---

## 2. Directory Structure & File Map

```
opencode-orchestrator/
├── package.json                          # Scripts, runtime & dev dependencies
├── tsconfig.json                         # TypeScript configuration (target: ES2022, bundler moduleResolution)
├── schema.sql                            # PostgreSQL DDL for tenants, sessions, and chat_events
├── .env.example                          # Environment variables template
├── README.md                             # User-facing guide & API documentation
├── AGENTS.md                             # Agent operating guide & engineering manual
│
├── src/
│   ├── index.ts                          # Express server, SSE turn handler & REST API routes
│   ├── cli.ts                            # Standalone CLI entrypoint (`opencode-orchestrator`)
│   ├── config.ts                         # Centralized environment & timeout configurations
│   ├── db/
│   │   ├── client.ts                     # PostgreSQL connection pool and query wrapper
│   │   └── sessionStore.ts               # State rehydration, turn history & summary persistence
│   ├── runner/
│   │   ├── sandbox.ts                    # Ephemeral sandbox directory manager & purge lifecycle
│   │   └── process.ts                    # Sub-process spawner, stdin/stdout stream handler & signal traps
│   ├── events/
│   │   ├── types.ts                      # Raw stdout events, AG-UI SSE payloads, DB entity types
│   │   └── aguiAdapter.ts                # Real-time OpenCode JSON -> AG-UI SSE protocol adapter
│   └── interactive/
│       └── interactionRegistry.ts        # In-flight approval registry & stdin dispatcher
│
└── tests/
    ├── unit/
    │   ├── cli.test.ts                   # CLI command and flag parsing tests
    │   ├── sandbox.test.ts               # Sandbox directory provisioning and purge tests
    │   ├── aguiAdapter.test.ts           # AG-UI event translation tests
    │   └── sessionStore.test.ts          # State rehydration & history prefix tests
    └── integration/
        ├── api.test.ts                   # Express endpoint validation tests
        ├── interactionFlow.test.ts       # Stdio pause, resume, and human-in-the-loop tests
        ├── turnStreamE2E.test.ts         # Full simulated E2E turn streaming & interaction tests
        └── realOpenCode.test.ts          # Real OpenCode CLI + OpenRouter live execution test
```

---

## 3. Key Components & Code Contracts

### 3.1 Sandbox Manager (`src/runner/sandbox.ts`)
- **`provision(config: SandboxConfig): Promise<SandboxEnvironment>`**
  - Creates `${baseDir}/${sessionId}/home` and `${baseDir}/${sessionId}/workspace`.
  - Injects `${home}/.config/opencode/opencode.json` with task configurations.
  - Injects `${home}/.local/share/opencode/auth.json` (mirrors host auth if present).
  - Injects `${workspace}/.opencode/skills/{skillName}/SKILL.md` for declarative skills.
- **`cleanup(sessionId: string): Promise<void>`**
  - Removes the entire session folder with `{ recursive: true, force: true }`.

### 3.2 Process Runner (`src/runner/process.ts`)
- **`OrchestratedProcess`**
  - Spawns `opencode run --pure --format json [-m <model>] <prompt>`.
  - Sets `HOME` to the sandboxed home directory and `USER` to `tenant_{userId}`.
  - Closes stdin on init for `opencode` binary to avoid blocking in non-TTY mode.
  - Emits `"event"` (`OpenCodeRawEvent`), `"stderr"`, `"error"`, and `"closed"`.
  - Exposes `writeStdin(payload)` for human-in-the-loop approvals.

### 3.3 AG-UI Protocol Adapter (`src/events/aguiAdapter.ts`)
Maps events according to the following protocol contract:

| OpenCode Event | AG-UI Event | Data Payload Details |
| :--- | :--- | :--- |
| `token` / `text` | `MESSAGE_START` / `TEXT_MESSAGE_CONTENT` | `{ messageId, role: "assistant", delta: text }` |
| `plan_update` | `STATE_DELTA` | `{ path: "/todos", op: "replace", value: todos }` |
| `step_finish` | `STATE_DELTA` | `{ path: "/metrics", op: "replace", value: { tokens, cost } }` |
| `tool_start` / `tool_use` | `TOOL_CALL_START` | `{ callId, tool, params }` |
| `tool_finish` / `tool_use` | `TOOL_CALL_RESULT` | `{ callId, result, isError }` |
| `permission_request` / `permission` | `INTERACTION_REQUEST` | `{ interactionId, type: "approval", tool, details, options }` |
| `session_compacted` | `STATE_DELTA` | `{ path: "/summary", op: "replace", value: summary }` |
| `done` | `MESSAGE_END` + `RUN_FINISHED` | `{ messageId }` + `{ runId, status, exitCode }` |

### 3.4 PostgreSQL Session Store (`src/db/sessionStore.ts`)
- **`rehydrateContext(sessionId, currentPrompt, maxTurns)`**: Composes summary + previous turns into a unified context prompt before calling OpenCode.
- **`recordChatEvent(sessionId, turnIndex, eventType, payload)`**: Persists all intermediate events to PostgreSQL `chat_events`.

---

## 4. Development & Testing Commands

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript distribution
npm run build

# 3. Run all tests (unit, integration, and real CLI)
npm test

# 4. Run tests in watch mode
npm run test:watch

# 5. Start API server in dev mode with live reload
npm run dev

# 6. Execute CLI directly
npm run cli -- run "List files in workspace" -m openrouter/deepseek/deepseek-v4-flash
```

---

## 5. Rules for Agents Modifying this Codebase

1. **Maintain Sandbox Isolation:** Never store persistent state on the local filesystem outside `/tmp/sandboxes/{sessionId}` during turn runs. Always call `sandboxManager.cleanup(sessionId)` in all termination paths.
2. **Preserve Protocol Compatibility:** Any changes to `AGUIStreamAdapter` must conform to the AG-UI specification and pass [`tests/unit/aguiAdapter.test.ts`](file:///Users/evenwei/Experiments/opencode-orchestrator/tests/unit/aguiAdapter.test.ts).
3. **Database Null-Safety:** Ensure all routes and operations handle scenarios where PostgreSQL is temporarily unreachable or unconfigured (graceful degraded mode in test environments).
4. **Clean Exit & Signal Handling:** Sub-processes must be killed with `SIGTERM` and sandboxes cleaned up on parent `SIGINT` / `SIGTERM`.
5. **Continuous Verification:** Run `npm run build && npm test` prior to submitting any changes.
