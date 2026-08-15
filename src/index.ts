import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { SandboxManager } from "./runner/sandbox";
import { OrchestratedProcess } from "./runner/process";
import { AGUIStreamAdapter } from "./events/aguiAdapter";
import { sessionStore } from "./db/sessionStore";
import { interactionRegistry } from "./interactive/interactionRegistry";
import { UserInteractionResolution, OpenCodeRawEvent } from "./events/types";
import { closePool, getPool } from "./db/client";
import { TurnTracer, shutdownTracer } from "./observability/tracer";
import {
  registry,
  turnsTotal,
  turnDurationSeconds,
  activeSessionsGauge,
  sandboxesProvisionedTotal,
  sandboxesCleanedTotal,
  tokensTotal,
  costUsdTotal,
  interactionsTotal,
  interactionsResolvedTotal,
  updateDbPoolMetrics,
  recordMetricToDb,
  getTelemetrySummary,
} from "./observability/metrics";

export const app = express();
app.use(express.json());

const sandboxManager = new SandboxManager(config.sandboxBaseDir);

interface ActiveSessionEntry {
  proc: OrchestratedProcess;
  adapter: AGUIStreamAdapter;
  tracer: TurnTracer;
  turnIndex: number;
  accumulatedText: string;
}

const activeSessions = new Map<string, ActiveSessionEntry>();

function extractString(val: unknown, fallback: string = ""): string {
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return fallback;
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/v1/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Kubernetes Liveness Probe
app.get("/livez", (req: Request, res: Response) => {
  res.status(200).send("ok");
});

// Kubernetes Readiness Probe (verifies PostgreSQL connectivity)
app.get("/readyz", async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    await pool.query("SELECT 1 AS ready");
    res.status(200).send("ready");
  } catch (err: any) {
    res.status(503).json({ status: "error", message: `Database unreachable: ${err.message}` });
  }
});

// Prometheus Metrics endpoint for Kubernetes / Grafana scraping
app.get("/metrics", async (req: Request, res: Response) => {
  try {
    updateDbPoolMetrics();
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  } catch (err: any) {
    res.status(500).send(err.message);
  }
});

// Operational Telemetry query endpoint (PostgreSQL / local telemetry)
app.get("/api/v1/telemetry", async (req: Request, res: Response) => {
  const limit = parseInt(extractString(req.query.limit, "100"), 10) || 100;
  const telemetry = await getTelemetrySummary(limit);
  return res.json({ count: telemetry.length, telemetry });
});

// Tenant creation endpoint
app.post("/api/v1/tenants", async (req: Request, res: Response) => {
  const { id, name } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: "Missing tenant 'id' or 'name'." });
  }
  try {
    const tenant = await sessionStore.ensureTenant(String(id), String(name));
    return res.status(201).json(tenant);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Session creation endpoint
app.post("/api/v1/sessions", async (req: Request, res: Response) => {
  const { id, tenantId, title } = req.body;
  const sessionId = id ? String(id) : `sess_${randomUUID()}`;
  const effectiveTenantId = tenantId ? String(tenantId) : "default_tenant";

  try {
    await sessionStore.ensureTenant(effectiveTenantId, "Default Tenant");
    const session = await sessionStore.createSession(
      sessionId,
      effectiveTenantId,
      title ? String(title) : undefined
    );
    return res.status(201).json(session);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get session details
app.get("/api/v1/sessions/:id", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  try {
    const session = await sessionStore.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }
    return res.json(session);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Get session events
app.get("/api/v1/sessions/:id/events", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  const limit = parseInt(extractString(req.query.limit, "50"), 10) || 50;
  try {
    const events = await sessionStore.getRecentChatEvents(sessionId, limit);
    return res.json(events);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Stream handler logic for a session turn
async function handleTurnStream(req: Request, res: Response) {
  const sessionId = extractString(req.params.id);
  const tenantId = extractString(req.body?.tenantId ?? req.query.tenantId, "default_tenant");
  const prompt = extractString(req.body?.prompt ?? req.query.prompt, "Hello OpenCode");
  const taskConfig = req.body?.taskConfig || { model: "anthropic/claude-3-5-sonnet" };
  const model = extractString(
    req.body?.model ?? req.query.model ?? taskConfig?.model,
    ""
  );
  const skills = req.body?.skills || [];
  const customBin = extractString(
    req.body?.binaryPath ?? req.query.binaryPath,
    config.opencodeBinPath
  );

  if (activeSessions.has(sessionId)) {
    return res.status(409).json({ error: "Session currently has an active turn running." });
  }

  // Acquire activeSessions lock immediately to prevent TOCTOU concurrency race conditions
  activeSessions.set(sessionId, null as any);

  // Track turn duration in Prometheus
  const turnTimer = turnDurationSeconds.startTimer({ tenant_id: tenantId });
  activeSessionsGauge.inc({ tenant_id: tenantId });

  // Ensure tenant and session exist in DB
  try {
    await sessionStore.ensureTenant(tenantId, `Tenant ${tenantId}`);
    await sessionStore.createSession(sessionId, tenantId);
    await sessionStore.updateSessionStatus(sessionId, "running");
  } catch {
    // Database might be optional in isolated test setups
  }

  // Rehydrate context from database (unless executing a test script starting with -e)
  let turnIndex = 1;
  let rehydratedPrompt = prompt;
  if (!prompt.startsWith("-e ")) {
    try {
      turnIndex = await sessionStore.getNextTurnIndex(sessionId);
      await sessionStore.recordChatEvent(sessionId, turnIndex, "user_prompt", { prompt });
      rehydratedPrompt = await sessionStore.rehydrateContext(sessionId, prompt);
    } catch {
      // fallback if db is not connected
    }
  }

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const runId = `run_${Date.now()}`;
  const adapter = new AGUIStreamAdapter(res, runId);
  const tracer = new TurnTracer(sessionId, tenantId, runId, model || "default", prompt);

  // Provision ephemeral sandbox
  const env = await sandboxManager.provision({
    sessionId,
    taskConfig,
    skills,
  });

  sandboxesProvisionedTotal.inc();
  recordMetricToDb("sandbox", "sandbox_provisioned", 1, {}, sessionId, tenantId);

  // Spawn sub-process
  const proc = new OrchestratedProcess(customBin, rehydratedPrompt, env, tenantId, {
    model: model || undefined,
  });
  const sessionEntry: ActiveSessionEntry = {
    proc,
    adapter,
    tracer,
    turnIndex,
    accumulatedText: "",
  };

  activeSessions.set(sessionId, sessionEntry);

  proc.on("event", async (rawEvent: OpenCodeRawEvent) => {
    // Handle interaction/permission request
    if (rawEvent.type === "permission_request") {
      interactionRegistry.register(
        sessionId,
        rawEvent.data.id,
        rawEvent.data.tool,
        rawEvent.data.details,
        proc,
        config.interactionTimeoutMs
      );
      tracer.onInteractionRequest(rawEvent.data.id, rawEvent.data.tool, rawEvent.data.details);
      interactionsTotal.inc({
        tenant_id: tenantId,
        tool: rawEvent.data.tool || "unknown",
        type: "approval",
      });
      recordMetricToDb(
        "interaction",
        "permission_request",
        1,
        { tool: rawEvent.data.tool, id: rawEvent.data.id },
        sessionId,
        tenantId
      );
      try {
        await sessionStore.updateSessionStatus(sessionId, "waiting_for_interaction");
        await sessionStore.recordChatEvent(
          sessionId,
          turnIndex,
          "permission_request",
          rawEvent.data
        );
      } catch {}
    } else if (rawEvent.type === "token") {
      sessionEntry.accumulatedText += rawEvent.data.delta;
    } else if (rawEvent.type === "text" && rawEvent.part?.text) {
      sessionEntry.accumulatedText += rawEvent.part.text;
    } else if (rawEvent.type === "tool_start") {
      tracer.onToolStart(rawEvent.data?.id || "tool", rawEvent.data?.tool || "tool", rawEvent.data?.params || {});
    } else if (rawEvent.type === "tool_finish") {
      tracer.onToolFinish(rawEvent.data?.id || "tool", rawEvent.data?.result || "", rawEvent.data?.isError ?? false);
    } else if (rawEvent.type === "tool_use" && rawEvent.part) {
      const part = rawEvent.part;
      const callId = part.callID || "tool";
      if (part.state?.status === "completed") {
        tracer.onToolFinish(callId, typeof part.state.output === "string" ? part.state.output : JSON.stringify(part.state.output), false);
      } else {
        tracer.onToolStart(callId, part.tool || "tool", part.state?.input || {});
      }
    } else if (rawEvent.type === "step_finish" && rawEvent.part) {
      tracer.onMetrics(rawEvent.part.tokens, rawEvent.part.cost);
      if (rawEvent.part.tokens) {
        const t = rawEvent.part.tokens;
        if (t.input) tokensTotal.inc({ tenant_id: tenantId, model: model || "default", type: "input" }, t.input);
        if (t.output) tokensTotal.inc({ tenant_id: tenantId, model: model || "default", type: "output" }, t.output);
        if (t.reasoning) tokensTotal.inc({ tenant_id: tenantId, model: model || "default", type: "reasoning" }, t.reasoning);
        recordMetricToDb("token", "tokens_consumed", t.total || 0, { tokens: t }, sessionId, tenantId);
      }
      if (rawEvent.part.cost) {
        costUsdTotal.inc({ tenant_id: tenantId, model: model || "default" }, rawEvent.part.cost);
        recordMetricToDb("token", "cost_usd", rawEvent.part.cost, {}, sessionId, tenantId);
      }
    } else if (rawEvent.type === "session_compacted") {
      try {
        await sessionStore.updateSessionSummary(sessionId, rawEvent.data.summary);
        await sessionStore.recordChatEvent(
          sessionId,
          turnIndex,
          "session_compacted",
          rawEvent.data
        );
      } catch {}
    } else if (rawEvent.type === "plan_update") {
      try {
        await sessionStore.recordChatEvent(sessionId, turnIndex, rawEvent.type, rawEvent as any);
      } catch {}
    }

    adapter.processRawEvent(rawEvent);
  });

  proc.on("stderr", (data: string) => {
    console.error(`[Process stderr] ${data}`);
  });

  proc.on("error", (err: Error) => {
    console.error(`[Process error] ${err.message}`);
  });

  proc.on("closed", async (exitCode: number) => {
    tracer.finish(exitCode === 0 ? "completed" : "failed", exitCode, sessionEntry.accumulatedText);

    // Update Prometheus and DB operational telemetry
    activeSessionsGauge.dec({ tenant_id: tenantId });
    sandboxesCleanedTotal.inc();
    const status = exitCode === 0 ? "completed" : "failed";
    turnTimer({ status });
    turnsTotal.inc({ tenant_id: tenantId, model: model || "default", status });
    recordMetricToDb("turn", "turn_finished", exitCode === 0 ? 1 : 0, { exitCode, status }, sessionId, tenantId);

    if (sessionEntry.accumulatedText) {
      try {
        await sessionStore.recordChatEvent(sessionId, turnIndex, "assistant_response", {
          text: sessionEntry.accumulatedText,
        });
      } catch {}
    }

    try {
      await sessionStore.updateSessionStatus(sessionId, status);
    } catch {}

    interactionRegistry.clear(sessionId);
    activeSessions.delete(sessionId);
    await sandboxManager.cleanup(sessionId);
  });

  proc.start();
}

// 1. Initiate Turn & Open AG-UI SSE Stream (Supports GET and POST)
app.get("/api/v1/sessions/:id/stream", handleTurnStream);
app.post("/api/v1/sessions/:id/stream", handleTurnStream);
app.post("/api/v1/sessions/:id/turn", handleTurnStream);

// 2. Resolve User Approval / Interaction via HTTP POST
app.post("/api/v1/sessions/:id/interactions", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  const resolution = req.body as UserInteractionResolution;

  if (!resolution || !resolution.interactionId || !resolution.resolution) {
    return res.status(400).json({ error: "Missing 'interactionId' or 'resolution'." });
  }

  const sessionEntry = activeSessions.get(sessionId);
  if (sessionEntry) {
    sessionEntry.tracer.onInteractionResolved(resolution.interactionId, resolution.resolution);
  }

  const resolved = interactionRegistry.resolve(sessionId, resolution);
  if (!resolved) {
    return res.status(404).json({ error: "No active session or pending interaction found." });
  }

  interactionsResolvedTotal.inc({
    tenant_id: "default_tenant",
    tool: "unknown",
    resolution: resolution.resolution,
  });
  recordMetricToDb(
    "interaction",
    "permission_resolved",
    1,
    { resolution: resolution.resolution, interactionId: resolution.interactionId },
    sessionId
  );

  try {
    await sessionStore.updateSessionStatus(sessionId, "running");
    await sessionStore.recordChatEvent(
      sessionId,
      0,
      "user_interaction_resolved",
      resolution as any
    );
  } catch {}

  return res.json({ status: "acknowledged", interactionId: resolution.interactionId });
});

// Explicit session cancel / abort endpoint
app.post("/api/v1/sessions/:id/cancel", async (req: Request, res: Response) => {
  const sessionId = extractString(req.params.id);
  const sessionEntry = activeSessions.get(sessionId);

  if (!sessionEntry || !sessionEntry.proc) {
    return res.status(404).json({ error: "No active turn currently running for this session." });
  }

  try {
    sessionEntry.proc.kill("SIGTERM");
    await sandboxManager.cleanup(sessionId).catch(() => {});
    activeSessions.delete(sessionId);
    await sessionStore.updateSessionStatus(sessionId, "failed").catch(() => {});
    return res.json({ status: "cancelled", sessionId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Process cleanup on exit
export async function cleanupAllSandboxes(): Promise<void> {
  const entries = Array.from(activeSessions.entries());
  activeSessions.clear();
  await Promise.all(
    entries.map(async ([sessionId, entry]) => {
      if (entry?.proc) {
        try {
          entry.proc.kill("SIGTERM");
        } catch {}
      }
      await sandboxManager.cleanup(sessionId).catch(() => {});
    })
  );
}

process.on("SIGTERM", async () => {
  await cleanupAllSandboxes();
  await shutdownTracer().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  await cleanupAllSandboxes();
  await shutdownTracer().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
});

export async function startServer(port: number = config.port) {
  const swept = await sandboxManager.initSweep();
  if (swept > 0) {
    console.log(`[Startup] Swept ${swept} orphaned sandbox directory(ies) from ${config.sandboxBaseDir}.`);
  }
  return app.listen(port, () => {
    console.log(`OpenCode Ephemeral Orchestrator listening on port ${port}`);
  });
}

if (require.main === module) {
  startServer();
}
