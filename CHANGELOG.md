# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-08-16

### 🚀 Initial Public Release

We are excited to announce the initial release of **`opencode-orchestrator`** (v0.1.0) — a multi-tenant, stateless execution engine and CLI for the OpenCode ecosystem.

### ✨ Key Features

#### 1. ⚡ Ephemeral Execution & TMPFS Isolation
- Stateless task execution in `/tmp/sandboxes/{sessionId}` with zero background daemon overhead.
- Automatic sandbox cleanup and startup orphan directory sweep (`initSweep`).
- Detached process groups with tree-killing (`process.kill(-pid, signal)`).

#### 2. 🐘 PostgreSQL Single Source of Truth
- Persistent multi-tenant session state, conversation turn history, and compacted session summaries.
- Automatic context rehydration constructing structured prompt prefixes before launching processes.

#### 3. 📡 AG-UI Protocol & Bidirectional Stdio RPC
- Real-time Server-Sent Events (SSE) adapter translating raw OpenCode JSON stream into standard AG-UI events.
- Bidirectional human-in-the-loop permission approvals via `POST /api/v1/sessions/:id/interactions`.
- Explicit turn cancellation via `POST /api/v1/sessions/:id/cancel`.

#### 4. 🔭 Native Self-Hosted Observability (Arize Phoenix & OpenInference)
- Native OpenTelemetry OTLP Protobuf trace exporter for Arize Phoenix (`http://localhost:6006`).
- OpenInference semantic convention compliance: `CHAIN`, `TOOL`, and `GUARDRAIL` spans.
- Captures token economics (`llm.token_count.*`), USD spend (`llm.cost`), and formatted chat messages (`llm.input_messages`).

#### 5. 📊 Service Telemetry & Grafana Dashboard (Kubernetes-Ready)
- Prometheus scrape endpoint at `GET /metrics` (`prom-client`) with turn counters, latency histograms, and process memory/CPU gauges.
- Relational operational telemetry in PostgreSQL (`orchestrator_telemetry` table and `GET /api/v1/telemetry`).
- Turnkey Grafana dashboard in `dashboards/grafana-orchestrator.json`.
- Kubernetes health probes: `/livez` (liveness) and `/readyz` (readiness with DB verification).

#### 6. 🏭 Agent Genesis & Continuous Iteration Engine
- **Verified MCP Catalog (`mcpCatalog.ts`)**: Pre-verified tools for Postgres, GitHub, Slack, SQLite, Fetch.
- **Curated Skills Library (`skillCatalog.ts`)**: Reusable operational manuals (`db-analyzer`, `git-release`, `pr-reviewer`, `security-auditor`, `api-tester`).
- **Deterministic Skill Linter (`linter.ts`)**: Enforces word count limits, frontmatter, and imperative directives.
- **Agent Synthesizer (`synthesizer.ts`)**: Compiles portable `AgentBundle` specifications.
- **Eval Runner (`evalRunner.ts`)**: Runs benchmark test suites in ephemeral sandboxes with deterministic assertions.
- **Diff-Driven Refiner (`refiner.ts`)**: Visual Git-style Red/Green diffs for `SKILL.md` with shadow regression checks.
- **Team Agent Registry (`agentStore.ts`)**: PostgreSQL `agent_templates` table for team catalog and 1-click execution (`run --agent <name>`).

#### 7. 💻 CLI & Developer Experience
- Standalone CLI execution (`run`, `serve`, `verify [--live]`, `migrate`, `health`).
- Agent lifecycle CLI commands: `agent init`, `agent test`, `agent iterate`, `agent publish`, `agent list`.
- Complete 5-stage automated diagnostic command: `npx opencode-orchestrator verify`.

---
