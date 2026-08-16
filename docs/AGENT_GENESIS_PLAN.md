# 🏭 Agent Genesis & Continuous Iteration Engine: Technical Blueprint & User Journey

## 1. Executive Summary & Vision

The goal is to empower any engineer, QA, or product team member to design, test, iterate, and publish production-grade AI agent configurations in **under 3 minutes**, without needing prior prompt engineering or MCP plumbing expertise.

The system treats agent configuration as a **living software artifact** with a full CI/CD lifecycle:
`Interview / Explore` $\rightarrow$ `Synthesize (with Guardrails)` $\rightarrow$ `Simulate & Benchmark` $\rightarrow$ `Iterate & Refine (Diff-Driven)` $\rightarrow$ `Publish to Registry` $\rightarrow$ `Continuous Trace Feedback`.

---

## 2. End-to-End User Journey (CLI & Web UI)

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 1. DISCOVERY & ONBOARDING                                              │
  │    • Option A: Starter Templates (PR Reviewer, DB Triage, Release Bot) │
  │    • Option B: Conversational Wizard (Outcome-based plain-English Qs)  │
  │    • Option C: Zero-Touch Repo Scan (Inspects schema, code, deps)      │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 2. AGENT SYNTHESIZER (Structured Meta-Agent & Linter)                  │
  │    • Verified MCP Catalog RAG (Prevents hallucinated packages)         │
  │    • Strict JSON Schema Decoding (Guarantees valid `AgentBundle`)       │
  │    • Deterministic Skill Linter (Enforces concise, imperative rules)   │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 3. INSTANT PLAYGROUND & SANDBOX SIMULATION                             │
  │    • Runs benchmark test cases in disposable `/tmp/sandboxes/{id}`     │
  │    • Live SSE execution stream & tool calls                            │
  │    • Visualizes trace & token costs via Arize Phoenix                  │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 4. ITERATIVE REFINEMENT LOOP (Hybrid Chat + Diff Editor)               │
  │    • Natural Language Feedback: "Don't touch migrations without review"│
  │    • Visual Red/Green Diff proposed for `SKILL.md` with manual tweak   │
  │    • Shadow Execution: Verifies no regressions against existing evals  │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ 5. PUBLISH, DISCOVERY & TEAM REGISTRY                                  │
  │    • Trust Badges: Telemetry stats (Success rate, avg cost, permissions│
  │    • 1-Click "Test Drive" Sandbox & "Fork & Remix" workflows           │
  │    • Invocable via CLI, Web UI, or REST API with 1-click               │
  └────────────────────────────────────────────────────────────────────────┘
```

---

### Step-by-Step Experience

#### Phase 1: Discovery & Onboarding
- **Template Starters:** Instead of a blank canvas, users can choose from verified starter blueprints:
  - `[🔍 Database Incident Responder]`
  - `[🚀 Semantic Release & Version Bumper]`
  - `[🛡️ Pull Request Security & Quality Reviewer]`
  - `[✨ Start from Scratch / Explore My Repo]`
- **Progressive Disclosure:** Smart defaults are applied automatically. Advanced settings (model temperature, timeout overrides) are tucked behind an `(Advanced Options)` toggle.
- **Outcome-Based Security Toggles:** Instead of asking for abstract permission rules, the wizard presents plain-English switches:
  ```text
  ? Allow this agent to execute database mutations (UPDATE/DELETE) without asking? [y/N]
  ```

#### Phase 2: Split-Screen Web IDE & Interactive CLI
- **Web UI Layout:**
  - **Left Pane:** Conversational "Agent Architect" chat for steering and feedback.
  - **Right Pane:** Live visual representation of the `AgentBundle`:
    - Syntax-highlighted `SKILL.md` editor with live updates.
    - Toggle switches for active MCP tools (Postgres, GitHub, Slack).
    - Integrated execution playground with Arize Phoenix trace drawer.
- **CLI Experience:** Rich terminal spinners (`[🔍] Scanning repo... [⚙️] Drafting SKILL.md... [✅] Agent compiled`) with arrow-key navigation.

#### Phase 3: Continuous Iteration & "Diff-Driven Refinement"
- When an agent misbehaves, the user provides natural language feedback:
  - *User feedback:* `"Make sure it only reads from the 'public' schema and never executes SELECT * without a LIMIT."`
  - *Action:* The synthesizer proposes a **Visual Git-style Diff** for `SKILL.md`.
  - *User Choice:* `[Accept Diff]` / `[Manually Edit]` / `[Reject]`.
  - *Regression Shield:* The synthesizer runs the new bundle against existing `evalSuite` cases before committing to guarantee previous workflows don't break.

#### Phase 4: Discovery, Trust & "Fork & Remix"
- The Team Catalog displays vital **Trust Badges** directly from production telemetry:
  - `billing-triager@1.2.0` — `✅ 98.4% Success Rate` | `⚡ Avg Latency: 4.2s` | `💰 Avg Cost: $0.002` | `🔒 1 Human Approval Required`.
- **1-Click "Test Drive":** Teammates can test-drive any published agent in an ephemeral sandbox with mock data before installing it into their workflow.
- **Fork & Remix:** Teammates can fork any existing agent, modify rules, and publish a child variant.

---

## 3. Standardized Agent Bundle Specification (`AgentBundle`)

```typescript
export interface AgentBundle {
  name: string;                         // e.g. "db-incident-responder"
  version: string;                      // Semantic version (e.g. "1.2.0")
  description: string;                  // Plain-text summary for team catalog
  owner: string;                        // Team / author email
  runtime: {
    model: string;                      // e.g. "openrouter/deepseek/deepseek-v4-flash"
    timeoutMs: number;                  // Maximum wall-clock time per turn
    maxTurnsPerSession?: number;
  };
  dependencies?: Record<string, string>;// Sub-agent dependencies (e.g. { "sql-sanitizer": "^1.0.0" })
  taskConfig: {
    mcp: Record<string, {               // Dynamic Model Context Protocol tools
      type: "local" | "remote";
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      enabled: boolean;
    }>;
  };
  skills: Array<{                       // Declarative operational manuals
    name: string;
    description: string;
    content: string;                    // SKILL.md Markdown contents
  }>;
  permissions: {                        // Guardrails and approval policies
    requireApprovalTools: string[];     // Tools requiring human confirmation (e.g. ["bash", "sql_write"])
    autoApprovedTools: string[];        // Read-only tools (e.g. ["read", "glob", "sql_read"])
  };
  evalSuite: Array<{                    // Benchmark regression test cases
    id: string;
    prompt: string;
    expectedTools?: string[];
    forbiddenPatterns?: string[];
    assertions?: Array<{                // Deterministic state assertions
      type: "file_exists" | "db_row_exists" | "output_contains";
      target: string;
    }>;
  }>;
}
```

---

## 4. Architecture & API Engine Endpoints

To support both CLI and Web UI clients, `opencode-orchestrator` exposes 4 core REST endpoints:

1. **`POST /api/v1/agents/synthesize`**
   - **Input:** `{ description, repoPath?, selectedMcp?, costProfile, rules? }`
   - **Process:** Enforces JSON schema output + verified MCP catalog RAG + Skill Linter.
   - **Output:** Fully compiled `AgentBundle` with synthesized `SKILL.md` and default test cases.

2. **`POST /api/v1/agents/test`**
   - **Input:** `{ agentBundle, testCaseIndex? }`
   - **Output:** SSE Stream of test execution in ephemeral sandbox with Phoenix trace link and assertion results.

3. **`POST /api/v1/agents/refine`**
   - **Input:** `{ currentBundle, feedbackText, failedTraceId? }`
   - **Process:** Generates targeted diff, runs shadow execution against `evalSuite`, and scrubs PII.
   - **Output:** Proposed patch, visual diff of `SKILL.md`, and regression test pass/fail results.

4. **`POST /api/v1/agents/publish` & `GET /api/v1/agents`**
   - **Input:** `AgentBundle`
   - **Output:** Published registry record with unique ID, invocation token, and telemetry summary.

---

## 5. Trace-to-Eval Feedback Loop & Multi-Agent Extensibility

### 🛡️ Production Trace Feedback Pipeline
1. **Failure Classification Triage:** Transient errors (network drops, rate limits) are ignored; only semantic logic errors (tool schema mismatches, `GUARDRAIL` rejections, SQL syntax errors) trigger the refinement loop.
2. **PII Anonymization:** Extracted production prompts are scrubbed before appending to the permanent `evalSuite`.
3. **1-Click Regression Test Creation:** Engineers click "Add Trace to Evals" in Arize Phoenix to lock in bug fixes.

### 🌐 Multi-Agent Nesting & Isolation
- **Nested Sandboxes:** When an agent invokes a sub-agent, it runs in an isolated sub-directory (`/tmp/sandboxes/{parentId}/sub/{childId}`).
- **Event Bubbling:** Security approval requests (`INTERACTION_REQUEST`) from nested child agents bubble cleanly up the AG-UI SSE stream to the root caller.
