# 📖 OpenCode Orchestrator — Client Turn Preparation & Configuration Manual

This manual provides a complete, production-ready guide for engineers and client applications (Web Frontends, IDE Extensions, Multi-Agent Supervisors, CI/CD Bots) preparing API calls to `opencode-orchestrator`.

---

## 📑 Table of Contents
1. [Endpoint Overview & Lifecycle](#1-endpoint-overview--lifecycle)
2. [Complete Request Payload Schema](#2-complete-request-payload-schema)
3. [Configuration Guide](#3-configuration-guide)
   - [3.1 Setting the Prompt](#31-setting-the-prompt)
   - [3.2 Choosing Models](#32-choosing-models)
   - [3.3 Declarative Skills (`SKILL.md`)](#33-declarative-skills-skillmd)
   - [3.4 Model Context Protocol (MCP) Servers](#34-model-context-protocol-mcp-servers)
   - [3.5 Injecting API Keys & Auth](#35-injecting-api-keys--auth)
4. [Client Implementation Examples](#4-client-implementation-examples)
   - [TypeScript / JavaScript (Browser & Node.js)](#typescript--javascript)
   - [Python (`httpx` SSE Streamer)](#python)
   - [cURL](#curl)
5. [Human-in-the-Loop (HITL) Interaction Handling](#5-human-in-the-loop-hitl-interaction-handling)
6. [Response Stream Events Reference (AG-UI Protocol)](#6-response-stream-events-reference-ag-ui-protocol)

---

## 1. Endpoint Overview & Lifecycle

Each turn is executed via a streaming Server-Sent Events (SSE) connection:

- **Primary Turn Endpoint:** `POST /api/v1/sessions/:sessionId/stream` (or `POST /api/v1/sessions/:sessionId/turn`)
- **HITL Interaction Endpoint:** `POST /api/v1/sessions/:sessionId/interactions`
- **Session History:** `GET /api/v1/sessions/:sessionId/events`

```
Client (Caller)                      Orchestrator Server                   Ephemeral Sandbox
      │                                       │                                   │
      │ 1. POST /sessions/:id/stream (JSON)   │                                   │
      ├──────────────────────────────────────>│ Provision TMPFS & Ingest Context  │
      │                                       ├──────────────────────────────────>│
      │                                       │ Spawn OpenCode sub-process        │
      │                                       │                                   │
      │ 2. SSE: MESSAGE_START                 │                                   │
      │<──────────────────────────────────────┤                                   │
      │ 3. SSE: TOOL_CALL_START / RESULT      │<── Stdout JSON Lines ─────────────┤
      │<──────────────────────────────────────┤                                   │
      │ 4. SSE: TEXT_MESSAGE_CONTENT (Tokens) │                                   │
      │<──────────────────────────────────────┤                                   │
      │                                       │ [If Permission Needed]            │
      │ 5. SSE: INTERACTION_REQUEST           │                                   │
      │<──────────────────────────────────────┤                                   │
      │ 6. POST /interactions (Decision)      │ Write to Stdin                    │
      ├──────────────────────────────────────>├──────────────────────────────────>│
      │                                       │                                   │
      │ 7. SSE: MESSAGE_END + RUN_FINISHED    │ Purge Sandbox (rm -rf)            │
      │<──────────────────────────────────────┤<──────────────────────────────────┤
```

---

## 2. Complete Request Payload Schema

```typescript
interface TurnStreamRequest {
  /** The natural language task or prompt for this turn */
  prompt: string;

  /** Multi-tenant org ID or User ID (used for isolation, DB mapping, and tracing) */
  tenantId?: string; // Default: "default_tenant"

  /** Model identifier override */
  model?: string; // e.g. "openrouter/deepseek/deepseek-v4-flash" or "anthropic/claude-3-5-sonnet"

  /** Dynamic opencode.json task and MCP configuration */
  taskConfig?: {
    model?: string;
    /** Model Context Protocol (MCP) server definitions */
    mcp?: Record<string, MCPServerConfig>;
    [key: string]: any;
  };

  /** Declarative agent skills to inject into the workspace */
  skills?: Array<{
    name: string;    // Directory name: .opencode/skills/{name}/SKILL.md
    content: string; // Markdown content with YAML frontmatter
  }>;

  /** Injected auth credentials (mirrors ~/.local/share/opencode/auth.json) */
  auth?: Record<string, any>;

  /** Custom path to the opencode binary if overriding default */
  binaryPath?: string;
}

type MCPServerConfig =
  | {
      type?: "local";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    }
  | {
      type: "remote";
      url: string;
      headers?: Record<string, string>;
      enabled?: boolean;
    };
```

---

## 3. Configuration Guide

### 3.1 Setting the Prompt
The `prompt` contains the task for the agent. If prior turns exist for the given `sessionId`, the orchestrator automatically rehydrates the recent conversation turns and session summary before sending to OpenCode:

```json
{
  "prompt": "Inspect the git status and create a release tag v1.1.0 following our semantic release rules."
}
```

---

### 3.2 Choosing Models
You can specify any model supported by OpenCode or your OpenRouter/Anthropic/OpenAI provider:

- `openrouter/deepseek/deepseek-v4-flash`
- `anthropic/claude-3-5-sonnet`
- `openai/gpt-4o`
- `google/gemini-2.0-flash`

```json
{
  "model": "openrouter/deepseek/deepseek-v4-flash"
}
```

---

### 3.3 Declarative Skills (`SKILL.md`)
Skills teach the agent specialized procedures. They are written in Markdown with YAML frontmatter (`name` and `description`):

```json
{
  "skills": [
    {
      "name": "db-analyzer",
      "content": "---\nname: db-analyzer\ndescription: Inspects database schemas, indexes, and queries using PostgreSQL MCP tools\n---\n# DB Analyzer Skill\n1. Query information_schema.tables to inspect tables.\n2. Summarize foreign keys.\n3. Recommend indexes for high-volume columns."
    }
  ]
}
```

The orchestrator dynamically injects this skill at `/tmp/sandboxes/{sessionId}/workspace/.opencode/skills/db-analyzer/SKILL.md`.

---

### 3.4 Model Context Protocol (MCP) Servers
MCP servers give the agent structured tools (database queries, GitHub APIs, filesystem access, remote tools).

#### Local Stdio MCP Servers:
```json
{
  "taskConfig": {
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
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "enabled": true
      }
    }
  }
}
```

#### Remote SSE MCP Servers:
```json
{
  "taskConfig": {
    "mcp": {
      "enterprise-crm": {
        "type": "remote",
        "url": "https://mcp.internal.company.com/sse",
        "headers": {
          "Authorization": "Bearer ssk_12345"
        },
        "enabled": true
      }
    }
  }
}
```

> **Note:** If `type` or `enabled` are omitted, `opencode-orchestrator` automatically normalizes `type` to `"local"` (or `"remote"`) and sets `enabled: true`.

---

### 3.5 Injecting API Keys & Auth
If the host server does not have global OpenCode auth, you can pass credentials per request in the `auth` property:

```json
{
  "auth": {
    "openrouter": {
      "apiKey": "sk-or-v1-..."
    },
    "anthropic": {
      "apiKey": "sk-ant-..."
    }
  }
}
```

---

## 4. Client Implementation Examples

### TypeScript / JavaScript

```typescript
import http from "node:http";

async function executeTurn(sessionId: string, prompt: string) {
  const payload = {
    tenantId: "tenant_dev_101",
    model: "openrouter/deepseek/deepseek-v4-flash",
    prompt,
    taskConfig: {
      model: "openrouter/deepseek/deepseek-v4-flash",
      mcp: {
        postgres: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://postgres:postgres@localhost:5432/opencode"]
        }
      }
    },
    skills: [
      {
        name: "db-analyzer",
        content: "---\nname: db-analyzer\ndescription: SQL inspector\n---\n# DB Analysis Guide..."
      }
    ]
  };

  const req = http.request(
    `http://localhost:8080/api/v1/sessions/${sessionId}/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    },
    (res) => {
      let buffer = "";

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          if (!block.trim()) continue;
          const eventMatch = block.match(/^event:\s*(\w+)/m);
          const dataMatch = block.match(/^data:\s*(.+)$/m);
          if (eventMatch && dataMatch) {
            const eventType = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);
            handleEvent(sessionId, eventType, data);
          }
        }
      });

      res.on("end", () => console.log("Turn stream closed."));
    }
  );

  req.write(JSON.stringify(payload));
  req.end();
}

function handleEvent(sessionId: string, eventType: string, data: any) {
  switch (eventType) {
    case "TEXT_MESSAGE_CONTENT":
      process.stdout.write(data.delta);
      break;
    case "TOOL_CALL_START":
      console.log(`\n⚙ [Executing Tool: ${data.tool}]`, data.params);
      break;
    case "TOOL_CALL_RESULT":
      console.log(`✓ [Tool Result]`, data.result);
      break;
    case "STATE_DELTA":
      if (data.path === "/metrics") {
        console.log(`\n[Tokens: ${data.value.tokens.total} | Cost: $${data.value.cost}]`);
      }
      break;
    case "INTERACTION_REQUEST":
      console.log(`\n⚠ Approval Needed (ID: ${data.interactionId}) for tool: ${data.tool}`);
      // Auto-approve or prompt user:
      resolveInteraction(sessionId, data.interactionId, "approved");
      break;
    case "RUN_FINISHED":
      console.log(`\n[Run Finished: ${data.status} (exitCode: ${data.exitCode})]`);
      break;
  }
}

async function resolveInteraction(sessionId: string, interactionId: string, resolution: "approved" | "rejected") {
  await fetch(`http://localhost:8080/api/v1/sessions/${sessionId}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interactionId, resolution })
  });
}
```

---

### Python

```python
import httpx
import json

def run_turn(session_id: str, prompt: str):
    url = f"http://localhost:8080/api/v1/sessions/{session_id}/stream"
    payload = {
        "tenantId": "tenant_python_01",
        "model": "openrouter/deepseek/deepseek-v4-flash",
        "prompt": prompt,
        "skills": [
            {
                "name": "git-release",
                "content": "---\nname: git-release\ndescription: Git release helper\n---\n# Guide..."
            }
        ]
    }

    with httpx.stream("POST", url, json=payload, timeout=300.0) as response:
        event_type = ""
        for line in response.iter_lines():
            if line.startswith("event:"):
                event_type = line.replace("event:", "").strip()
            elif line.startswith("data:"):
                data_str = line.replace("data:", "").strip()
                data = json.loads(data_str)
                
                if event_type == "TEXT_MESSAGE_CONTENT":
                    print(data.get("delta", ""), end="", flush=True)
                elif event_type == "TOOL_CALL_START":
                    print(f"\n⚙ [Tool: {data.get('tool')}] {data.get('params')}")
                elif event_type == "RUN_FINISHED":
                    print(f"\n[Completed with status: {data.get('status')}]")

if __name__ == "__main__":
    run_turn("sess_py_101", "List workspace files and create a summary.")
```

---

### cURL

```bash
curl -N -X POST http://localhost:8080/api/v1/sessions/sess_curl_001/stream \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant_101",
    "model": "openrouter/deepseek/deepseek-v4-flash",
    "prompt": "Create a database index on chat_events(turn_index)",
    "skills": [
      {
        "name": "db-analyzer",
        "content": "---\nname: db-analyzer\ndescription: SQL inspector\n---\n# DB Guide"
      }
    ]
  }'
```

---

## 5. Human-in-the-Loop (HITL) Interaction Handling

When OpenCode requires user approval before executing a sensitive action (e.g. `DROP TABLE` or destructive file removal), execution suspends and emits an `INTERACTION_REQUEST` SSE event:

```http
event: INTERACTION_REQUEST
data: {
  "interactionId": "perm_001",
  "type": "approval",
  "tool": "bash",
  "details": {
    "command": "rm -rf /tmp/data"
  },
  "options": ["approve", "reject"]
}
```

### Resolving the Request
Send a `POST` request to `/api/v1/sessions/:sessionId/interactions`:

```http
POST /api/v1/sessions/sess_101/interactions
Content-Type: application/json

{
  "interactionId": "perm_001",
  "resolution": "approved",
  "data": {
    "selectedOption": "approve",
    "feedback": "Approved by engineering lead"
  }
}
```

**Response:**
```json
{
  "status": "acknowledged",
  "interactionId": "perm_001"
}
```

The orchestrator writes the decision into the OpenCode subprocess's `stdin` and execution resumes instantly.

---

## 6. Response Stream Events Reference (AG-UI Protocol)

| AG-UI Event Type | Payload Format | Description |
| :--- | :--- | :--- |
| `MESSAGE_START` | `{"messageId": "msg_...", "role": "assistant", "runId": "run_..."}` | Emitted at start of turn |
| `TEXT_MESSAGE_CONTENT` | `{"messageId": "msg_...", "delta": "string"}` | Streaming assistant response tokens |
| `TOOL_CALL_START` | `{"callId": "call_...", "tool": "bash", "params": {...}}` | Tool execution initiated |
| `TOOL_CALL_RESULT` | `{"callId": "call_...", "result": "...", "isError": false}` | Tool completed execution |
| `STATE_DELTA` (`/todos`) | `{"path": "/todos", "op": "replace", "value": [...]}` | Progress plan / checklist update |
| `STATE_DELTA` (`/metrics`) | `{"path": "/metrics", "op": "replace", "value": {"tokens": {...}, "cost": 0.001}}` | Token usage & cost updates |
| `STATE_DELTA` (`/summary`) | `{"path": "/summary", "op": "replace", "value": "compacted text"}` | Updated session summary |
| `INTERACTION_REQUEST` | `{"interactionId": "perm_...", "tool": "...", "details": {...}}` | Approval request halting execution |
| `MESSAGE_END` | `{"messageId": "msg_..."}` | Assistant message completed |
| `RUN_FINISHED` | `{"runId": "run_...", "status": "completed"|"failed", "exitCode": 0}` | Final stream conclusion event |
