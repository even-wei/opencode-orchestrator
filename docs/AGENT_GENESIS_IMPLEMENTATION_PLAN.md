# 🛠️ Agent Genesis & Continuous Iteration Engine: Implementation Plan

## 1. Overview & Architectural Goals

This document outlines the step-by-step implementation plan for adding the **Agent Genesis & Continuous Iteration Engine** to `opencode-orchestrator`.

The implementation is structured into **5 distinct phases**:
1. **Domain Data Models & Database Schema**
2. **Verified MCP Catalog, Codebase Scanner & Meta-Agent Synthesizer**
3. **Sandbox Evaluation Runner & Diff-Driven Refinement Engine**
4. **Interactive CLI Wizard (`opencode-orchestrator agent`)**
5. **REST API Routes & Production Test Suite**

---

## 2. Directory Structure & Module Additions

```text
src/
├── agent-factory/
│   ├── types.ts              # AgentBundle, EvalSuite, MCP Catalog & API interfaces
│   ├── mcpCatalog.ts         # Verified catalog of standard MCP tools & repo scanner
│   ├── linter.ts             # Deterministic SKILL.md validator and linter
│   ├── synthesizer.ts        # Meta-Agent prompt engineer & AgentBundle compiler
│   ├── evalRunner.ts         # Sandbox benchmark executor & deterministic assertion engine
│   └── refiner.ts            # Diff-driven iterative steering & shadow regression runner
│
├── db/
│   ├── agentStore.ts         # CRUD & telemetry aggregation for PostgreSQL agent_templates
│   └── ...
│
└── cli/
    └── agentCli.ts           # Interactive Inquirer CLI wizard (init, test, iterate, publish)
```

---

## 3. Phase-by-Phase Roadmap

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 1: Data Contracts & PostgreSQL Schema                            │
  │ • Define TypeScript interfaces for AgentBundle, Assertions, Evals      │
  │ • Add `agent_templates` table in schema.sql & create agentStore.ts     │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 2: Verified MCP Catalog & Meta-Agent Synthesizer                 │
  │ • Built-in verified MCP catalog (Postgres, GitHub, Slack, FS, Sentry)  │
  │ • Codebase scanner (package.json, schema.sql, Dockerfile inspector)   │
  │ • Synthesizer prompt + Deterministic Skill Linter                      │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 3: Benchmark Runner & Diff-Driven Refinement Engine              │
  │ • Sandbox evalRunner with deterministic state assertions               │
  │ • Refiner module: computes unified diffs for SKILL.md                  │
  │ • Shadow regression execution against historical test cases            │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 4: Interactive CLI Experience (`opencode-orchestrator agent`)    │
  │ • `agent init` (Starter templates + Interactive Inquirer questions)    │
  │ • `agent test` (Live sandbox run + Phoenix trace link)                 │
  │ • `agent iterate` (Interactive diff review & manual tweak)             │
  │ • `agent publish` & `agent list` (Catalog with trust telemetry)        │
  │ • `run --agent <name@version>` (Direct execution of registered agent)  │
  └───────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │ PHASE 5: REST API Endpoints & Verification Test Suite                  │
  │ • POST /api/v1/agents/synthesize                                       │
  │ • POST /api/v1/agents/test (SSE stream with live assertions)           │
  │ • POST /api/v1/agents/refine (Diff proposal & shadow test)             │
  │ • GET / POST /api/v1/agents (Catalog & trust stats)                    │
  │ • Full unit and E2E integration test suite                             │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detailed Phase Specifications

### Phase 1: Data Contracts & Database Schema

#### 1.1 Types Definition (`src/agent-factory/types.ts`)
Define:
- `AgentBundle`: Complete portable agent specification (name, version, runtime model, skills, MCP configs, permissions, eval suite).
- `EvalTestCase` & `EvalAssertion`: Hard post-condition assertions (`file_exists`, `db_row_exists`, `output_contains`, `expected_tool_called`).
- `AgentTemplateRecord`: Database entity representing published agents in PostgreSQL.

#### 1.2 Database Schema (`schema.sql` & `src/db/agentStore.ts`)
Add table to `schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS agent_templates (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    version VARCHAR(32) NOT NULL,
    owner VARCHAR(128) NOT NULL DEFAULT 'platform_team',
    description TEXT,
    bundle_json JSONB NOT NULL,
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_templates_name ON agent_templates(name);
```
Implement `agentStore.ts` with `saveAgentTemplate`, `getAgentTemplate(name, version?)`, `listAgentTemplates()`, and `deleteAgentTemplate()`.

---

### Phase 2: Verified MCP Catalog, Scanner & Synthesizer

#### 2.1 Verified MCP Catalog (`src/agent-factory/mcpCatalog.ts`)
- Pre-configured verified MCP servers (eliminates LLM package hallucinations):
  - `postgres`: `@modelcontextprotocol/server-postgres`
  - `github`: `@modelcontextprotocol/server-github`
  - `filesystem`: `@modelcontextprotocol/server-filesystem`
  - `slack`: `@modelcontextprotocol/server-slack`
  - `sqlite`: `@modelcontextprotocol/server-sqlite`
  - `fetch`: `@modelcontextprotocol/server-fetch`
- **Repository Scanner (`scanRepository(repoPath)`):**
  - Scans for `package.json`, `go.mod`, `pom.xml`, `requirements.txt`.
  - Scans for database schema files (`schema.sql`, `prisma/schema.prisma`).
  - Detects Docker/Kubernetes files to infer required tools automatically.

#### 2.2 Skill Linter (`src/agent-factory/linter.ts`)
Deterministic validator for generated `SKILL.md`:
- Word count $< 500$ words (prevents instruction bloat and model attention degradation).
- Valid frontmatter (`name`, `description`).
- Valid action directives (must include imperative triggers and boundary rules).

#### 2.3 Meta-Agent Synthesizer (`src/agent-factory/synthesizer.ts`)
- Uses structured prompts running directly on the orchestrator's OpenCode engine.
- Ingests user intent + scanned repo schemas + verified MCP definitions.
- Generates a fully formed `AgentBundle` with default test cases.

---

### Phase 3: Sandbox Benchmark Runner & Refinement Engine

#### 3.1 Eval Runner (`src/agent-factory/evalRunner.ts`)
- Provisions an ephemeral sandbox for the `AgentBundle`.
- Injects generated skills and MCP configs.
- Executes each `evalSuite` test case.
- Validates deterministic assertions (`file_exists`, `output_contains`, `expected_tools`).
- Emits real-time SSE events with Phoenix trace URLs and token costs.

#### 3.2 Diff-Driven Refinement Engine (`src/agent-factory/refiner.ts`)
- Ingests current `AgentBundle` + natural language feedback + optional failed Phoenix trace ID.
- Computes unified diff for `SKILL.md` (e.g. using `diff` library).
- Runs **Shadow Execution**: re-runs the modified bundle against existing test cases to prevent regressions.
- Returns `{ updatedBundle, diff, shadowTestResults }`.

---

### Phase 4: Interactive CLI Experience

#### 4.1 CLI Commands (`src/cli/agentCli.ts`)
Extend `src/cli.ts` with subcommands:

1. **`opencode-orchestrator agent init`**
   - Offers starter templates (`[PR Reviewer]`, `[DB Triage]`, `[Explore Repo]`, `[Custom]`).
   - Asks 3 outcome-based questions.
   - Runs synthesizer with live terminal spinner.
   - Writes ready-to-run `./agent.json`.

2. **`opencode-orchestrator agent test <agent.json>`**
   - Runs all test cases in the bundle against ephemeral sandboxes.
   - Prints formatted assertion summary and token cost table.

3. **`opencode-orchestrator agent iterate <agent.json>`**
   - Prompts for natural language feedback.
   - Displays visual red/green diff in terminal.
   - Prompts: `[A]ccept and apply / [M]anually edit / [R]eject`.

4. **`opencode-orchestrator agent publish <agent.json>`**
   - Validates bundle and registers it into PostgreSQL `agent_templates`.

5. **`opencode-orchestrator agent list`**
   - Prints table of published team agents with trust badges (success rate, avg latency, cost).

6. **`opencode-orchestrator run --agent <name[@version]> "<prompt>"`**
   - Loads agent from PostgreSQL registry and executes the turn directly.

---

### Phase 5: REST API & Production Test Suite

#### 5.1 REST API Routes (`src/index.ts`)
- `POST /api/v1/agents/synthesize`: Generates draft `AgentBundle`.
- `POST /api/v1/agents/test`: Executes live sandbox test with SSE streaming.
- `POST /api/v1/agents/refine`: Generates diff and runs regression check.
- `POST /api/v1/agents/publish`: Persists bundle to PostgreSQL.
- `GET /api/v1/agents`: Returns team catalog with aggregated telemetry.
- `GET /api/v1/agents/:name`: Returns specific bundle version.

#### 5.2 Test Coverage
- `tests/unit/mcpCatalog.test.ts`: Scanner and verified catalog tests.
- `tests/unit/linter.test.ts`: Skill linter validation rules.
- `tests/unit/synthesizer.test.ts`: Meta-agent bundle synthesis tests.
- `tests/unit/refiner.test.ts`: Diff generation and shadow regression tests.
- `tests/integration/agentLifecycleE2E.test.ts`: Full E2E cycle: Init $\rightarrow$ Synthesize $\rightarrow$ Test $\rightarrow$ Refine $\rightarrow$ Publish $\rightarrow$ Run.

---

## 5. Verification & Rollout Plan

1. **Step 1:** Implement Phase 1 (Schema & DB Store) + run `psql schema.sql`.
2. **Step 2:** Implement Phase 2 (Catalog, Scanner, Linter & Synthesizer) + unit tests.
3. **Step 3:** Implement Phase 3 (Eval Runner & Refiner) + test assertions.
4. **Step 4:** Implement Phase 4 (CLI commands) & test interactive terminal flow.
5. **Step 5:** Implement Phase 5 (REST API routes) + full Vitest test suite (`npm test`).
6. **Step 6:** Run live end-to-end verification with `opencode-orchestrator agent init` and live LLM turn.
